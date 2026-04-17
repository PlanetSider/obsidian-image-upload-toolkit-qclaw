/**
 * 图床切换器
 * 在设置面板配置源域名和目标域名后，执行命令遍历所有笔记，
 * 将图片链接中的源域名替换为目标域名。
 * 不重新上传，只做 URL 文本替换。
 */
import {App, Notice, TFile} from "obsidian";
import {PublishSettings} from "../publish";
import UploadProgressModal from "../ui/uploadProgressModal";

export default class StoreSwitcher {
    private app: App;
    private settings: PublishSettings;

    constructor(app: App, settings: PublishSettings) {
        this.app = app;
        this.settings = settings;
    }

    /**
     * 执行图床切换
     * @param sourceDomain 源域名（图片 URL 中要替换的域名）
     * @param targetDomain 目标域名（替换后的域名）
     */
    async switch(sourceDomain: string, targetDomain: string): Promise<{
        filesChanged: number;
        linksReplaced: number;
    }> {
        if (!sourceDomain || !targetDomain) {
            new Notice("图床切换：源域名和目标域名均不能为空。", 4000);
            return { filesChanged: 0, linksReplaced: 0 };
        }

        if (sourceDomain === targetDomain) {
            new Notice("图床切换：源域名和目标域名不能相同。", 4000);
            return { filesChanged: 0, linksReplaced: 0 };
        }

        const files = this.app.vault.getMarkdownFiles();
        let totalReplaced = 0;
        let filesChanged = 0;

        const progressModal = new UploadProgressModal(this.app);
        progressModal.open();
        progressModal.initialize([{ name: "正在扫描笔记...", url: "" }]);

        for (let i = 0; i < files.length; i++) {
            const file = files[i];

            // 排除 .obsidian
            if (file.path.startsWith(".obsidian")) continue;

            progressModal.updateProgress(`${file.path} (${i + 1}/${files.length})`, true);

            try {
                const content = await this.app.vault.read(file);
                const replaced = this.replaceUrls(content, sourceDomain, targetDomain);

                if (replaced.count > 0) {
                    await this.app.vault.modify(file, replaced.content);
                    filesChanged++;
                    totalReplaced += replaced.count;
                }
            } catch (e) {
                console.error(`图床切换处理失败 [${file.path}]:`, e);
            }
        }

        progressModal.close();

        new Notice(
            `图床切换完成：共修改 ${filesChanged} 个文件，替换 ${totalReplaced} 处链接。`,
            6000,
        );

        return { filesChanged, linksReplaced: totalReplaced };
    }

    /**
     * 在内容中替换图片链接的域名
     * @returns { count: 替换数量, content: 替换后的内容 }
     */
    private replaceUrls(
        content: string,
        sourceDomain: string,
        targetDomain: string,
    ): { count: number; content: string } {
        // 匹配 markdown 图片语法: ![alt](url)
        const mdRegex = /\!\[([^\]]*)\]\((https?:\/\/[^\)]+)\)/g;
        let count = 0;
        let result = content;

        // 替换 markdown 图片
        result = result.replace(mdRegex, (_match, alt, url) => {
            if (url.includes(sourceDomain)) {
                count++;
                return `![${alt}](${url.replace(sourceDomain, targetDomain)})`;
            }
            return _match;
        });

        // 匹配 wiki 图片语法: ![[image.png]] 或 ![[path/image.png|size]]
        const wikiRegex = /\!\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
        // Wiki 语法没有 URL，所以只替换有域名的（通常是外部 wiki 链接）
        // 对于纯 wiki 图片（如附件引用），无法判断域名，所以不处理

        return { count, content: result };
    }
}

/**
 * 从设置中获取配置的域名列表（供设置面板下拉使用）
 */
export function getConfiguredDomains(settings: PublishSettings): { label: string; value: string }[] {
    const domains: { label: string; value: string }[] = [];

    const s = settings;

    // 第一图床
    if (s.ossSetting?.customDomainName) domains.push({ label: `阿里云 OSS (${s.ossSetting.customDomainName})`, value: s.ossSetting.customDomainName });
    if (s.awsS3Setting?.customDomainName) domains.push({ label: `AWS S3 (${s.awsS3Setting.customDomainName})`, value: s.awsS3Setting.customDomainName });
    if (s.cosSetting?.customDomainName) domains.push({ label: `腾讯云 COS (${s.cosSetting.customDomainName})`, value: s.cosSetting.customDomainName });
    if (s.kodoSetting?.customDomainName) domains.push({ label: `七牛云 (${s.kodoSetting.customDomainName})`, value: s.kodoSetting.customDomainName });
    if (s.r2Setting?.customDomainName) domains.push({ label: `Cloudflare R2 (${s.r2Setting.customDomainName})`, value: s.r2Setting.customDomainName });
    if (s.b2Setting?.customDomainName) domains.push({ label: `Backblaze B2 (${s.b2Setting.customDomainName})`, value: s.b2Setting.customDomainName });
    if (s.imagekitSetting?.endpoint) {
        try { domains.push({ label: `ImageKit (${new URL(s.imagekitSetting.endpoint).hostname})`, value: new URL(s.imagekitSetting.endpoint).hostname }); } catch {}
    }
    // 无自定义域名的默认域名
    if (!s.ossSetting?.customDomainName) domains.push({ label: "阿里云 OSS (默认域名)", value: "aliyuncs.com" });
    if (!s.awsS3Setting?.customDomainName) domains.push({ label: "AWS S3 (默认域名)", value: "amazonaws.com" });
    if (!s.cosSetting?.customDomainName) domains.push({ label: "腾讯云 COS (默认域名)", value: "myqcloud.com" });
    if (!s.kodoSetting?.customDomainName) domains.push({ label: "七牛云 (默认域名)", value: "qiniudn.com" });
    if (!s.r2Setting?.customDomainName) domains.push({ label: "Cloudflare R2 (默认域名)", value: "r2.dev" });
    domains.push({ label: "Imgur (imgur.com)", value: "imgur.com" });
    domains.push({ label: "Imgur CDN (i.imgur.com)", value: "i.imgur.com" });
    domains.push({ label: "Gyazo (gyazo.com)", value: "gyazo.com" });
    if (s.githubSetting?.repositoryName) {
        domains.push({ label: `GitHub (${s.githubSetting.repositoryName})`, value: "github.com" });
    }

    // 第二图床
    if (s.enableSecondStore) {
        if (s.secondOssSetting?.customDomainName) domains.push({ label: `[第二] 阿里云 OSS (${s.secondOssSetting.customDomainName})`, value: s.secondOssSetting.customDomainName });
        if (s.secondAwsS3Setting?.customDomainName) domains.push({ label: `[第二] AWS S3 (${s.secondAwsS3Setting.customDomainName})`, value: s.secondAwsS3Setting.customDomainName });
        if (s.secondCosSetting?.customDomainName) domains.push({ label: `[第二] 腾讯云 COS (${s.secondCosSetting.customDomainName})`, value: s.secondCosSetting.customDomainName });
        if (s.secondKodoSetting?.customDomainName) domains.push({ label: `[第二] 七牛云 (${s.secondKodoSetting.customDomainName})`, value: s.secondKodoSetting.customDomainName });
        if (s.secondR2Setting?.customDomainName) domains.push({ label: `[第二] Cloudflare R2 (${s.secondR2Setting.customDomainName})`, value: s.secondR2Setting.customDomainName });
        if (s.secondB2Setting?.customDomainName) domains.push({ label: `[第二] Backblaze B2 (${s.secondB2Setting.customDomainName})`, value: s.secondB2Setting.customDomainName });
        if (s.secondImagekitSetting?.endpoint) {
            try { domains.push({ label: `[第二] ImageKit (${new URL(s.secondImagekitSetting.endpoint).hostname})`, value: new URL(s.secondImagekitSetting.endpoint).hostname }); } catch {}
        }
    }

    return domains;
}
