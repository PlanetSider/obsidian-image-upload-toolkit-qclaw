/**
 * 批量上传处理器
 * 遍历 vault 中所有笔记，上传其中的本地图片（跳过已上传到第一/第二图床的图片）。
 * 成功上传后直接修改原笔记文件。
 */
import {App, Notice, TFile} from "obsidian";
import path from "path";
import ImageUploader from "./imageUploader";
import {PublishSettings} from "../publish";
import {isAlreadyHosted} from "./imageTagProcessor";
import {logUploadFailures, FailureEntry} from "./uploadFailureLogger";
import {convertToWebp} from "./imageConverter";
import UploadProgressModal from "../ui/uploadProgressModal";

export interface BatchUploadOptions {
    excludePaths: string[]; // 额外排除的路径前缀列表（如 "templates/", ".obsidian/"）
    updateDoc: boolean;      // 是否直接修改原笔记（总是 true）
    useModal: boolean;       // 是否显示进度弹窗
}

const DEFAULT_OPTIONS: BatchUploadOptions = {
    excludePaths: [],
    updateDoc: true,
    useModal: true,
};

/**
 * 获取图片链接的 URL 域名
 */
function getImageUrlHostname(url: string): string | null {
    try {
        const urlObj = new URL(url);
        return urlObj.hostname;
    } catch {
        return null;
    }
}

/**
 * 获取图床的域名列表（第一 + 第二）
 */
function getConfiguredHostnames(settings: PublishSettings): string[] {
    const hosts: string[] = [];

    const s = settings;
    const add = (hostname: string | undefined | null) => {
        if (hostname) hosts.push(hostname);
    };

    add(getImageUrlHostname(s.imgurAnonymousSetting?.clientId ?? ""));
    // gyazo — hostname not easily derivable from token, skip domain check for gyazo

    if (s.ossSetting?.customDomainName) add(s.ossSetting.customDomainName);
    if (s.awsS3Setting?.customDomainName) add(s.awsS3Setting.customDomainName);
    if (s.cosSetting?.customDomainName) add(s.cosSetting.customDomainName);
    if (s.kodoSetting?.customDomainName) add(s.kodoSetting.customDomainName);
    if (s.githubSetting?.repositoryName) add("github.com");
    if (s.r2Setting?.customDomainName) add(s.r2Setting.customDomainName);
    if (s.b2Setting?.customDomainName) add(s.b2Setting.customDomainName);
    if (s.imagekitSetting?.endpoint) {
        try { add(new URL(s.imagekitSetting.endpoint).hostname); } catch {}
    }

    // 第二网盘
    if (s.enableSecondStore) {
        if (s.secondOssSetting?.customDomainName) add(s.secondOssSetting.customDomainName);
        if (s.secondAwsS3Setting?.customDomainName) add(s.secondAwsS3Setting.customDomainName);
        if (s.secondCosSetting?.customDomainName) add(s.secondCosSetting.customDomainName);
        if (s.secondKodoSetting?.customDomainName) add(s.secondKodoSetting.customDomainName);
        if (s.secondGithubSetting?.repositoryName) add("github.com");
        if (s.secondR2Setting?.customDomainName) add(s.secondR2Setting.customDomainName);
        if (s.secondB2Setting?.customDomainName) add(s.secondB2Setting.customDomainName);
        if (s.secondImagekitSetting?.endpoint) {
            try { add(new URL(s.secondImagekitSetting.endpoint).hostname); } catch {}
        }
    }

    return [...new Set(hosts)];
}

export default class BatchUploader {
    private app: App;
    private settings: PublishSettings;
    private uploader: ImageUploader;
    private secondUploader: ImageUploader | null;
    private adapter;
    private options: BatchUploadOptions;
    private progressModal: UploadProgressModal | null = null;

    constructor(
        app: App,
        settings: PublishSettings,
        uploader: ImageUploader,
        secondUploader: ImageUploader | null,
        options: Partial<BatchUploadOptions> = {},
    ) {
        this.app = app;
        this.settings = settings;
        this.uploader = uploader;
        this.secondUploader = secondUploader;
        this.adapter = app.vault.adapter;
        this.options = { ...DEFAULT_OPTIONS, ...options };
    }

    /**
     * 启动批量上传
     */
    async run(): Promise<{ success: number; failed: number; skipped: number }> {
        const { files, total } = await this.collectNoteFiles();

        const stats = { success: 0, failed: 0, skipped: 0 };

        if (total === 0) {
            new Notice("批量上传：vault 中没有找到需要处理的笔记。", 4000);
            return stats;
        }

        if (this.options.useModal) {
            this.progressModal = new UploadProgressModal(this.app);
            this.progressModal.open();
            this.progressModal.initialize([
                { name: `正在处理 ${total} 个笔记...`, url: "" },
            ]);
        }

        const hostnames = getConfiguredHostnames(this.settings);
        const basePath = this.adapter.getBasePath();

        for (let i = 0; i < files.length; i++) {
            const file = files[i];

            if (this.progressModal) {
                this.progressModal.updateProgress(`${file.path} (${i + 1}/${total})`, true);
            }

            const result = await this.processNote(file, hostnames, basePath);
            stats.success += result.success;
            stats.failed += result.failed;
            stats.skipped += result.skipped;
        }

        if (this.progressModal) {
            this.progressModal.close();
        }

        const msg = `批量上传完成：成功 ${stats.success}，失败 ${stats.failed}，跳过 ${stats.skipped}`;
        new Notice(msg, 6000);
        return stats;
    }

    /**
     * 收集 vault 中所有 .md 文件（排除 .obsidian 和额外配置路径）
     */
    private async collectNoteFiles(): Promise<{ files: TFile[]; total: number }> {
        const allFiles = this.app.vault.getMarkdownFiles();
        const excludeSet = new Set([
            ".obsidian/",
            ".obsidian\\",
            ...this.options.excludePaths,
        ]);

        const files = allFiles.filter(f => {
            for (const ex of excludeSet) {
                if (f.path.startsWith(ex)) return false;
            }
            return true;
        });

        return { files, total: files.length };
    }

    /**
     * 处理单个笔记中的所有图片
     */
    private async processNote(
        file: TFile,
        hostnames: string[],
        basePath: string,
    ): Promise<{ success: number; failed: number; skipped: number }> {
        const content = await this.app.vault.read(file);
        const images = this.extractImageRefs(content);

        const stats = { success: 0, failed: 0, skipped: 0 };

        for (const img of images) {
            if (img.isHosted) {
                stats.skipped++;
                continue;
            }

            if (img.isWeb) {
                // 网络图片，根据设置决定是否处理
                if (!this.settings.uploadWebImages) {
                    stats.skipped++;
                    continue;
                }
                // 下载并上传网络图片
                const ok = await this.uploadWebImage(img, file, basePath, content);
                if (ok) stats.success++;
                else stats.failed++;
                continue;
            }

            // 本地图片
            const ok = await this.uploadLocalImage(img, file, basePath);
            if (ok) stats.success++;
            else stats.failed++;
        }

        return stats;
    }

    /**
     * 从笔记内容中提取所有图片引用
     */
    private extractImageRefs(content: string): ImageRef[] {
        const refs: ImageRef[] = [];
        const mdRegex = /\!\[(.*?)\]\((.*?\.(png|jpg|jpeg|gif|svg|webp|excalidraw))\)/g;
        const wikiRegex = /\!\[\[(.*?\.(png|jpg|jpeg|gif|svg|webp|excalidraw))(|.*)?\]\]/g;

        for (const m of content.matchAll(mdRegex)) {
            const url = m[2];
            refs.push({
                source: m[0],
                name: decodeURI(url.split("/").pop() ?? url),
                url,
                isWeb: this.isWebUrl(url),
            });
        }
        for (const m of content.matchAll(wikiRegex)) {
            refs.push({
                source: m[0],
                name: decodeURI(m[1]),
                url: m[1],
                isWeb: false,
            });
        }

        // 去重
        const seen = new Set<string>();
        return refs.filter(r => {
            if (seen.has(r.source)) return false;
            seen.add(r.source);
            return true;
        });
    }

    /**
     * 检查图片是否已托管在配置的图床
     */
    private isHosted(url: string, hostnames: string[]): boolean {
        try {
            const hostname = new URL(url).hostname;
            return hostnames.some(h => hostname.includes(h));
        } catch {
            return false;
        }
    }

    private isWebUrl(url: string): boolean {
        return url.startsWith("http://") || url.startsWith("https://");
    }

    /**
     * 上传本地图片并修改原笔记
     */
    private async uploadLocalImage(
        img: ImageRef,
        noteFile: TFile,
        basePath: string,
    ): Promise<boolean> {
        try {
            // 解析图片路径
            const targetFile = this.app.metadataCache.getFirstLinkpathDest(img.url, noteFile.path);
            const resolvedPath = targetFile?.path ?? img.url;

            const absFile = this.app.vault.getAbstractFileByPath(resolvedPath);
            if (!absFile || !(absFile instanceof TFile)) {
                return false;
            }

            const buf = await this.adapter.readBinary(resolvedPath);
            let file = new File([buf], absFile.name);

            // WebP 转换
            if (this.settings.convertToWebp) {
                file = await convertToWebp(file, (this.settings.webpQuality ?? 80) / 100);
            }

            const fullPath = basePath + '/' + resolvedPath;
            const imgUrl = await this.uploader.upload(file, fullPath);

            // 第二网盘上传（非阻塞）
            if (this.secondUploader) {
                this.uploadToSecondStore(file, fullPath);
            }

            // 修改原笔记
            const content = await this.app.vault.read(noteFile);
            const altText = this.settings.imageAltText
                ? absFile.name.replace(/\.[^.]+$/, "").replaceAll("-", " ").replaceAll("_", " ")
                : "";
            const newTag = `![${altText}](${imgUrl})`;
            if (content.includes(img.source)) {
                await this.app.vault.modify(noteFile, content.replace(img.source, newTag));
            }

            return true;
        } catch (e) {
            console.error(`批量上传失败 [${noteFile.path}] ${img.url}:`, e);
            await logUploadFailures(this.app, [{
                notePath: noteFile.path,
                imageName: img.name,
                error: e instanceof Error ? e.message : String(e),
                timestamp: new Date().toISOString(),
            }]);
            return false;
        }
    }

    /**
     * 上传网络图片（下载后上传）
     */
    private async uploadWebImage(
        img: ImageRef,
        noteFile: TFile,
        basePath: string,
        originalContent: string,
    ): Promise<boolean> {
        // Web 图片下载逻辑可复用 WebImageDownloader
        // 这里简化处理：跳过（需要引入 WebImageDownloader）
        return false;
    }

    /**
     * 第二网盘上传（非阻塞，失败重试3次）
     */
    private async uploadToSecondStore(file: File, fullPath: string): Promise<void> {
        if (!this.secondUploader) return;
        const maxRetries = 3;
        let lastError: Error | null = null;
        for (let i = 0; i < maxRetries; i++) {
            try {
                await this.secondUploader!.upload(file, fullPath);
                return;
            } catch (e) {
                lastError = e instanceof Error ? e : new Error(String(e));
                if (i < maxRetries - 1) {
                    new Notice(`第二网盘上传失败，第 ${i + 2} 次重试中...`, 3000);
                }
            }
        }
        const entry: FailureEntry = {
            notePath: "批量上传",
            imageName: file.name,
            error: lastError?.message ?? "未知错误",
            timestamp: new Date().toISOString(),
        };
        await logUploadFailures(this.app, [entry]);
    }
}

interface ImageRef {
    source: string;  // 原始 markdown 语法文本
    name: string;    // 图片文件名
    url: string;     // URL 或本地路径
    isWeb: boolean;  // 是否为网络图片
}
