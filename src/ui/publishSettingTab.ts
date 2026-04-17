import {App, PluginSettingTab, Setting} from "obsidian";
import ObsidianPublish from "../publish";
import ImageStore from "../imageStore";
import {AliYunRegionList} from "../uploader/oss/common";
import {TencentCloudRegionList} from "../uploader/cos/common";

export default class PublishSettingTab extends PluginSettingTab {
    private plugin: ObsidianPublish;
    private imageStoreDiv: HTMLDivElement;
    private secondImageStoreDiv: HTMLDivElement;

    constructor(app: App, plugin: ObsidianPublish) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): any {
        const {containerEl} = this;
        containerEl.empty()
        this.plugin.settings.imageStore = ImageStore.normalizeId(this.plugin.settings.imageStore);

        // ── 通用 ──
        containerEl.createEl("h2", {text: "通用"});

        new Setting(containerEl)
            .setName("使用图片名作为 Alt Text")
            .setDesc("是否使用图片名作为 Alt Text，其中 '-' 和 '_' 替换为空格。")
            .addToggle(toggle =>
                toggle
                    .setValue(this.plugin.settings.imageAltText)
                    .onChange(value => this.plugin.settings.imageAltText = value)
            );

        new Setting(containerEl)
            .setName("更新原文档")
            .setDesc("是否将内部链接替换为图床链接。")
            .addToggle(toggle =>
                toggle
                    .setValue(this.plugin.settings.replaceOriginalDoc)
                    .onChange(value => this.plugin.settings.replaceOriginalDoc = value)
            );

        new Setting(containerEl)
            .setName("忽略笔记属性")
            .setDesc("复制到剪贴板时是否忽略笔记属性（不影响原笔记）。")
            .addToggle(toggle =>
                toggle
                    .setValue(this.plugin.settings.ignoreProperties)
                    .onChange(value => this.plugin.settings.ignoreProperties = value)
            );

        // ── 上传 ──
        containerEl.createEl("h2", {text: "上传"});

        new Setting(containerEl)
            .setName("显示进度弹窗")
            .setDesc("上传图片时显示详细进度的弹窗对话框（3秒后自动关闭）。如果关闭，将使用更简单的状态指示器。")
            .addToggle(toggle =>
                toggle
                    .setValue(this.plugin.settings.showProgressModal)
                    .onChange(value => this.plugin.settings.showProgressModal = value)
            );

        new Setting(containerEl)
            .setName("上传网络图片")
            .setDesc("启用后，网络图片（http/https URL）将被下载并重新上传到您配置的存储。已托管在您存储服务上的图片将被跳过。")
            .addToggle(toggle =>
                toggle
                    .setValue(this.plugin.settings.uploadWebImages)
                    .onChange(value => this.plugin.settings.uploadWebImages = value)
            );

        // ── Mermaid ──
        containerEl.createEl("h2", {text: "Mermaid"});

        new Setting(containerEl)
            .setName("将 Mermaid 图表转换为图片")
            .setDesc("在发布时将 Mermaid 代码块渲染为 PNG 图片并上传。")
            .addToggle(toggle =>
                toggle
                    .setValue(this.plugin.settings.convertMermaid)
                    .onChange(value => this.plugin.settings.convertMermaid = value)
            );

        new Setting(containerEl)
            .setName("Mermaid 图片缩放")
            .setDesc("导出图片的缩放倍数（1x–4x）。Retina 屏幕推荐 2x。")
            .addSlider(slider =>
                slider
                    .setLimits(1, 4, 1)
                    .setValue(this.plugin.settings.mermaidScale)
                    .setDynamicTooltip()
                    .onChange(value => this.plugin.settings.mermaidScale = value)
            );

        new Setting(containerEl)
            .setName("Mermaid 主题")
            .setDesc("渲染图表的颜色主题。")
            .addDropdown(dd => {
                const themes: Record<string, string> = {
                    "default": "默认",
                    "dark": "深色",
                    "forest": "森林",
                    "neutral": "中性",
                    "base": "基础",
                };
                Object.entries(themes).forEach(([value, label]) => dd.addOption(value, label));
                dd.setValue(this.plugin.settings.mermaidTheme);
                dd.onChange(value => this.plugin.settings.mermaidTheme = value);
            });

        // ── 图床设置 ──
        containerEl.createEl("h2", {text: "图床设置"});

        const imageStoreTypeDiv = containerEl.createDiv();
        this.imageStoreDiv = containerEl.createDiv();

        new Setting(imageStoreTypeDiv)
            .setName("图床类型")
            .setDesc("上传图片的远程图床。")
            .addDropdown(dd => {
                ImageStore.lists.forEach(s => {
                    dd.addOption(s.id, s.description);
                });
                dd.setValue(this.plugin.settings.imageStore);
                dd.onChange(async (v) => {
                    this.plugin.settings.imageStore = v;
                    this.plugin.setupImageUploader();
                    await this.drawImageStoreSettings(this.imageStoreDiv);
                });
            });
        this.drawImageStoreSettings(this.imageStoreDiv);

        // ── 第二图床 ──
        containerEl.createEl("h2", {text: "第二图床"});

        new Setting(containerEl)
            .setName("启用第二图床")
            .setDesc("上传图片时同步上传到第二图床作为备份。失败时自动重试3次，仍失败则记录到 upload-failures.md。")
            .addToggle(toggle =>
                toggle
                    .setValue(this.plugin.settings.enableSecondStore)
                    .onChange(async value => {
                        this.plugin.settings.enableSecondStore = value;
                        await this.plugin.saveSettings();
                        this.plugin.setupImageUploader();
                    })
            );

        if (this.plugin.settings.enableSecondStore) {
            const secondImageStoreTypeDiv = containerEl.createDiv();
            this.secondImageStoreDiv = containerEl.createDiv();

            new Setting(secondImageStoreTypeDiv)
                .setName("第二图床类型")
                .setDesc("第二图床的上传目标。")
                .addDropdown(dd => {
                    ImageStore.lists.forEach(s => {
                        dd.addOption(s.id, s.description);
                    });
                    dd.setValue(this.plugin.settings.secondImageStore);
                    dd.onChange(async (v) => {
                        this.plugin.settings.secondImageStore = v;
                        await this.plugin.saveSettings();
                        this.plugin.setupImageUploader();
                        await this.drawSecondImageStoreSettings(this.secondImageStoreDiv);
                    });
                });
            this.drawSecondImageStoreSettings(this.secondImageStoreDiv);
        }
    }

    async hide(): Promise<any> {
        await this.plugin.saveSettings();
        this.plugin.setupImageUploader();
    }

    private async drawImageStoreSettings(parentEL: HTMLDivElement) {
        parentEL.empty();
        switch (ImageStore.normalizeId(this.plugin.settings.imageStore)) {
            case ImageStore.IMGUR.id:
                this.drawImgurSetting(parentEL);
                break;
            case ImageStore.GYAZO.id:
                this.drawGyazoSetting(parentEL);
                break;
            case ImageStore.ALIYUN_OSS.id:
                this.drawOSSSetting(parentEL);
                break;
            case ImageStore.ImageKit.id:
                this.drawImageKitSetting(parentEL);
                break;
            case ImageStore.AWS_S3.id:
                this.drawAwsS3Setting(parentEL);
                break;
            case ImageStore.TENCENTCLOUD_COS.id:
                this.drawTencentCloudCosSetting(parentEL);
                break;
            case ImageStore.QINIU_KUDO.id:
                this.drawQiniuSetting(parentEL);
                break
            case ImageStore.GITHUB.id:
                this.drawGitHubSetting(parentEL);
                break;
            case ImageStore.CLOUDFLARE_R2.id:
                this.drawR2Setting(parentEL);
                break;
            case ImageStore.BACKBLAZE_B2.id:
                this.drawB2Setting(parentEL);
                break;
            default:
                throw new Error(
                    "Should not reach here!"
                )
        }
    }

    // Imgur 设置
    private drawImgurSetting(parentEL: HTMLDivElement) {
        new Setting(parentEl)
            .setName("Client ID")
            .setDesc(PublishSettingTab.clientIdSettingDescription())
            .addText(text =>
                text
                    .setPlaceholder("输入 Client ID")
                    .setValue(this.plugin.settings.imgurAnonymousSetting.clientId)
                    .onChange(value => this.plugin.settings.imgurAnonymousSetting.clientId = value)
            )
    }

    private static clientIdSettingDescription() {
        const fragment = document.createDocumentFragment();
        const a = document.createElement("a");
        const url = "https://api.imgur.com/oauth2/addclient";
        a.textContent = url;
        a.setAttribute("href", url);
        fragment.append("在 ");
        fragment.append(a);
        fragment.append(" 生成你自己的 Client ID。");
        return fragment;
    }

    // Gyazo 设置
    private drawGyazoSetting(parentEL: HTMLDivElement) {
        new Setting(parentEL)
            .setName("Access Token")
            .setDesc(PublishSettingTab.gyazoTokenSettingDescription())
            .addText(text =>
                text
                    .setPlaceholder("输入 Access Token")
                    .setValue(this.plugin.settings.gyazoSetting.accessToken)
                    .onChange(value => this.plugin.settings.gyazoSetting.accessToken = value)
            );

        new Setting(parentEL)
            .setName("访问权限")
            .setDesc("设置图片可见性。仅当你不需要他人或外部网站访问上传图片 URL 时，才选择 '仅我自己(only_me)'。")
            .addDropdown(dropdown =>
                dropdown
                    .addOption("anyone", "所有人(anyone)")
                    .addOption("only_me", "仅我自己(only_me)")
                    .setValue(this.plugin.settings.gyazoSetting.accessPolicy)
                    .onChange((value: "anyone" | "only_me") => this.plugin.settings.gyazoSetting.accessPolicy = value)
            );

        new Setting(parentEL)
            .setName("统一描述")
            .setDesc("每次上传都会应用的固定描述。留空则不填描述字段。")
            .addText(text =>
                text
                    .setPlaceholder("输入统一描述（可选）")
                    .setValue(this.plugin.settings.gyazoSetting.desc)
                    .onChange(value => this.plugin.settings.gyazoSetting.desc = value)
            );
    }

    private static gyazoTokenSettingDescription() {
        const fragment = document.createDocumentFragment();
        const a = document.createElement("a");
        const url = "https://gyazo.com/oauth/applications";
        a.textContent = url;
        a.setAttribute("href", url);
        fragment.append("在 ");
        fragment.append(a);
        fragment.append(" 创建应用并获取 Access Token。");
        return fragment;
    }

    // 阿里云 OSS 设置
    private drawOSSSetting(parentEL: HTMLDivElement) {
        new Setting(parentEL)
            .setName("区域")
            .setDesc("OSS 数据中心区域。")
            .addDropdown(dropdown =>
                dropdown
                    .addOptions(AliYunRegionList)
                    .setValue(this.plugin.settings.ossSetting.region)
                    .onChange(value => {
                        this.plugin.settings.ossSetting.region = value;
                        this.plugin.settings.ossSetting.endpoint = `https://${value}.aliyuncs.com/`;
                    })
            )
        new Setting(parentEL)
            .setName("Access Key ID")
            .setDesc("阿里云 RAM 的 Access Key ID。")
            .addText(text =>
                text
                    .setPlaceholder("输入 Access Key ID")
                    .setValue(this.plugin.settings.ossSetting.accessKeyId)
                    .onChange(value => this.plugin.settings.ossSetting.accessKeyId = value))
        new Setting(parentEL)
            .setName("Access Key Secret")
            .setDesc("阿里云 RAM 的 Access Key Secret。")
            .addText(text =>
                text
                    .setPlaceholder("输入 Access Key Secret")
                    .setValue(this.plugin.settings.ossSetting.accessKeySecret)
                    .onChange(value => this.plugin.settings.ossSetting.accessKeySecret = value))
        new Setting(parentEL)
            .setName("Bucket 名称")
            .setDesc("存储图片的 Bucket 名称。")
            .addText(text =>
                text
                    .setPlaceholder("输入 Bucket 名称")
                    .setValue(this.plugin.settings.ossSetting.bucket)
                    .onChange(value => this.plugin.settings.ossSetting.bucket = value))

        new Setting(parentEL)
            .setName("存储路径")
            .setDesc("图片存储路径。\n支持 {year} {mon} {day} {random} {filename} 变量。例如上传 pic.jpg 时填写 /{year}/{mon}/{day}/{filename}，文件将存储为 /2023/06/08/pic.jpg。")
            .addText(text =>
                text
                    .setPlaceholder("输入路径")
                    .setValue(this.plugin.settings.ossSetting.path)
                    .onChange(value => this.plugin.settings.ossSetting.path = value))

        new Setting(parentEL)
            .setName("自定义域名")
            .setDesc("如果自定义域名是 example.com，则可以用 https://example.com/pic.jpg 访问 pic.jpg。")
            .addText(text =>
                text
                    .setPlaceholder("输入自定义域名")
                    .setValue(this.plugin.settings.ossSetting.customDomainName)
                    .onChange(value => this.plugin.settings.ossSetting.customDomainName = value))
    }

    // ImageKit 设置
    private drawImageKitSetting(parentEL: HTMLDivElement) {
        new Setting(parentEL)
            .setName("ImageKit ID")
            .setDesc(PublishSettingTab.imagekitSettingDescription())
            .addText(text =>
                text
                    .setPlaceholder("输入你的 ImageKit ID")
                    .setValue(this.plugin.settings.imagekitSetting.imagekitID)
                    .onChange(value => {
                        this.plugin.settings.imagekitSetting.imagekitID = value
                        this.plugin.settings.imagekitSetting.endpoint = `https://ik.imagekit.io/${value}/`
                    }))

        new Setting(parentEL)
            .setName("文件夹名称")
            .setDesc("请输入目录名称，如不需要则留空。")
            .addText(text =>
                text
                    .setPlaceholder("输入文件夹名称")
                    .setValue(this.plugin.settings.imagekitSetting.folder)
                    .onChange(value => this.plugin.settings.imagekitSetting.folder = value))

        new Setting(parentEL)
            .setName("公钥")
            .addText(text =>
                text
                    .setPlaceholder("输入你的公钥")
                    .setValue(this.plugin.settings.imagekitSetting.publicKey)
                    .onChange(value => this.plugin.settings.imagekitSetting.publicKey = value))

        new Setting(parentEL)
            .setName("私钥")
            .addText(text =>
                text
                    .setPlaceholder("输入你的私钥")
                    .setValue(this.plugin.settings.imagekitSetting.privateKey)
                    .onChange(value => this.plugin.settings.imagekitSetting.privateKey = value))
    }

    private static imagekitSettingDescription() {
        const fragment = document.createDocumentFragment();
        const a = document.createElement("a");
        const url = "https://imagekit.io/dashboard/developer/api-keys";
        a.textContent = url;
        a.setAttribute("href", url);
        fragment.append("在 ");
        fragment.append(a);
        fragment.append(" 获取 ID 和密钥。");
        return fragment;
    }

    // AWS S3 设置
    private drawAwsS3Setting(parentEL: HTMLDivElement) {
        new Setting(parentEL)
            .setName("AWS S3 Access Key ID")
            .setDesc("你的 AWS S3 Access Key ID。")
            .addText(text => text
                .setPlaceholder("输入 Access Key ID")
                .setValue(this.plugin.settings.awsS3Setting?.accessKeyId || '')
                .onChange(value => this.plugin.settings.awsS3Setting.accessKeyId = value
                ));

        new Setting(parentEL)
            .setName("AWS S3 Secret Access Key")
            .setDesc("你的 AWS S3 Secret Access Key。")
            .addText(text => text
                .setPlaceholder("输入 Secret Access Key")
                .setValue(this.plugin.settings.awsS3Setting?.secretAccessKey || '')
                .onChange(value => this.plugin.settings.awsS3Setting.secretAccessKey = value));

        new Setting(parentEL)
            .setName("AWS S3 区域")
            .setDesc("你的 AWS S3 区域。")
            .addText(text => text
                .setPlaceholder("输入区域")
                .setValue(this.plugin.settings.awsS3Setting?.region || '')
                .onChange(value => this.plugin.settings.awsS3Setting.region = value));

        new Setting(parentEL)
            .setName("AWS S3 Bucket 名称")
            .setDesc("你的 AWS S3 Bucket 名称。")
            .addText(text => text
                .setPlaceholder("输入 Bucket 名称")
                .setValue(this.plugin.settings.awsS3Setting?.bucketName || '')
                .onChange(value => this.plugin.settings.awsS3Setting.bucketName = value));

        new Setting(parentEL)
            .setName("存储路径")
            .setDesc("图片存储路径。\n支持 {year} {mon} {day} {random} {filename} 变量。例如上传 pic.jpg 时填写 /{year}/{mon}/{day}/{filename}，文件将存储为 /2023/06/08/pic.jpg。")
            .addText(text =>
                text
                    .setPlaceholder("输入路径")
                    .setValue(this.plugin.settings.awsS3Setting.path)
                    .onChange(value => this.plugin.settings.awsS3Setting.path = value))

        new Setting(parentEL)
            .setName("自定义域名")
            .setDesc("如果自定义域名是 example.com，则可以用 https://example.com/pic.jpg 访问 pic.jpg。")
            .addText(text =>
                text
                    .setPlaceholder("输入自定义域名")
                    .setValue(this.plugin.settings.awsS3Setting.customDomainName)
                    .onChange(value => this.plugin.settings.awsS3Setting.customDomainName = value))
    }

    // 腾讯云 COS 设置
    private drawTencentCloudCosSetting(parentEL: HTMLDivElement) {
        new Setting(parentEL)
            .setName("区域")
            .setDesc("COS 数据中心区域。")
            .addDropdown(dropdown =>
                dropdown
                    .addOptions(TencentCloudRegionList)
                    .setValue(this.plugin.settings.cosSetting.region)
                    .onChange(value => {
                        this.plugin.settings.cosSetting.region = value;
                    })
            )
        new Setting(parentEL)
            .setName("Secret Id")
            .setDesc("腾讯云的 Secret Id。")
            .addText(text =>
                text
                    .setPlaceholder("输入 Secret Id")
                    .setValue(this.plugin.settings.cosSetting.secretId)
                    .onChange(value => this.plugin.settings.cosSetting.secretId = value))
        new Setting(parentEL)
            .setName("Secret Key")
            .setDesc("腾讯云的 Secret Key。")
            .addText(text =>
                text
                    .setPlaceholder("输入 Secret Key")
                    .setValue(this.plugin.settings.cosSetting.secretKey)
                    .onChange(value => this.plugin.settings.cosSetting.secretKey = value))
        new Setting(parentEL)
            .setName("Bucket 名称")
            .setDesc("存储图片的 Bucket 名称。")
            .addText(text =>
                text
                    .setPlaceholder("输入 Bucket 名称")
                    .setValue(this.plugin.settings.cosSetting.bucket)
                    .onChange(value => this.plugin.settings.cosSetting.bucket = value))

        new Setting(parentEL)
            .setName("存储路径")
            .setDesc("图片存储路径。\n支持 {year} {mon} {day} {random} {filename} 变量。例如上传 pic.jpg 时填写 /{year}/{mon}/{day}/{filename}，文件将存储为 /2023/06/08/pic.jpg。")
            .addText(text =>
                text
                    .setPlaceholder("输入路径")
                    .setValue(this.plugin.settings.cosSetting.path)
                    .onChange(value => this.plugin.settings.cosSetting.path = value))

        new Setting(parentEL)
            .setName("自定义域名")
            .setDesc("如果自定义域名是 example.com，则可以用 https://example.com/pic.jpg 访问 pic.jpg。")
            .addText(text =>
                text
                    .setPlaceholder("输入自定义域名")
                    .setValue(this.plugin.settings.cosSetting.customDomainName)
                    .onChange(value => this.plugin.settings.cosSetting.customDomainName = value))
    }

    // 七牛云设置
    private drawQiniuSetting(parentEL: HTMLDivElement) {
        new Setting(parentEL)
            .setName("Access Key")
            .setDesc("七牛云的 Access Key。")
            .addText(text =>
                text
                    .setPlaceholder("输入 Access Key")
                    .setValue(this.plugin.settings.kodoSetting.accessKey)
                    .onChange(value => this.plugin.settings.kodoSetting.accessKey = value))
        new Setting(parentEL)
            .setName("Secret Key")
            .setDesc("七牛云的 Secret Key。")
            .addText(text =>
                text
                    .setPlaceholder("输入 Secret Key")
                    .setValue(this.plugin.settings.kodoSetting.secretKey)
                    .onChange(value => this.plugin.settings.kodoSetting.secretKey = value))
        new Setting(parentEL)
            .setName("Bucket 名称")
            .setDesc("存储图片的 Bucket 名称。")
            .addText(text =>
                text
                    .setPlaceholder("输入 Bucket 名称")
                    .setValue(this.plugin.settings.kodoSetting.bucket)
                    .onChange(value => this.plugin.settings.kodoSetting.bucket = value))

        new Setting(parentEL)
            .setName("自定义域名")
            .setDesc("如果自定义域名是 example.com，则可以用 https://example.com/pic.jpg 访问 pic.jpg。")
            .addText(text =>
                text
                    .setPlaceholder("输入自定义域名")
                    .setValue(this.plugin.settings.kodoSetting.customDomainName)
                    .onChange(value => this.plugin.settings.kodoSetting.customDomainName = value))
    }

    // GitHub 设置
    private drawGitHubSetting(parentEL: HTMLDivElement) {
        new Setting(parentEL)
            .setName("仓库名称")
            .setDesc("存储图片的 GitHub 仓库名称（格式：owner/repo）。")
            .addText(text =>
                text
                    .setPlaceholder("输入仓库名称（例如 username/repo）")
                    .setValue(this.plugin.settings.githubSetting.repositoryName)
                    .onChange(value => this.plugin.settings.githubSetting.repositoryName = value)
            );

        new Setting(parentEL)
            .setName("分支名称")
            .setDesc("存储图片的分支（默认为 main）。")
            .addText(text =>
                text
                    .setPlaceholder("输入分支名称")
                    .setValue(this.plugin.settings.githubSetting.branchName)
                    .onChange(value => this.plugin.settings.githubSetting.branchName = value)
            );

        new Setting(parentEL)
            .setName("Personal Access Token")
            .setDesc(PublishSettingTab.githubTokenDescription())
            .addText(text =>
                text
                    .setPlaceholder("输入你的 GitHub Personal Access Token")
                    .setValue(this.plugin.settings.githubSetting.token)
                    .onChange(value => this.plugin.settings.githubSetting.token = value)
            );
    }

    private static githubTokenDescription() {
        const fragment = document.createDocumentFragment();
        const a = document.createElement("a");
        const url = "https://github.com/settings/tokens";
        a.textContent = url;
        a.setAttribute("href", url);
        fragment.append("在 ");
        fragment.append(a);
        fragment.append(" 生成具有 'repo' 权限的 Personal Access Token。");
        return fragment;
    }

    // Cloudflare R2 设置
    private drawR2Setting(parentEL: HTMLDivElement) {
        new Setting(parentEL)
            .setName("Cloudflare R2 Access Key ID")
            .setDesc("你的 Cloudflare R2 Access Key ID。")
            .addText(text => text
                .setPlaceholder("输入 Access Key ID")
                .setValue(this.plugin.settings.r2Setting?.accessKeyId || '')
                .onChange(value => this.plugin.settings.r2Setting.accessKeyId = value
                ));

        new Setting(parentEL)
            .setName("Cloudflare R2 Secret Access Key")
            .setDesc("你的 Cloudflare R2 Secret Access Key。")
            .addText(text => text
                .setPlaceholder("输入 Secret Access Key")
                .setValue(this.plugin.settings.r2Setting?.secretAccessKey || '')
                .onChange(value => this.plugin.settings.r2Setting.secretAccessKey = value));

        new Setting(parentEL)
            .setName("Cloudflare R2 Endpoint")
            .setDesc("你的 Cloudflare R2 Endpoint URL（例如 https://account-id.r2.cloudflarestorage.com）。")
            .addText(text => text
                .setPlaceholder("输入 R2 Endpoint")
                .setValue(this.plugin.settings.r2Setting?.endpoint || '')
                .onChange(value => this.plugin.settings.r2Setting.endpoint = value));

        new Setting(parentEL)
            .setName("Cloudflare R2 Bucket 名称")
            .setDesc("你的 Cloudflare R2 Bucket 名称。")
            .addText(text => text
                .setPlaceholder("输入 Bucket 名称")
                .setValue(this.plugin.settings.r2Setting?.bucketName || '')
                .onChange(value => this.plugin.settings.r2Setting.bucketName = value));

        new Setting(parentEL)
            .setName("存储路径")
            .setDesc("图片存储路径。\n支持 {year} {mon} {day} {random} {filename} 变量。例如上传 pic.jpg 时填写 /{year}/{mon}/{day}/{filename}，文件将存储为 /2023/06/08/pic.jpg。")
            .addText(text =>
                text
                    .setPlaceholder("输入路径")
                    .setValue(this.plugin.settings.r2Setting.path)
                    .onChange(value => this.plugin.settings.r2Setting.path = value));

        new Setting(parentEL)
            .setName("R2.dev URL / 自定义域名")
            .setDesc("可以使用 R2.dev URL（如 https://pub-xxxx.r2.dev），也可以填自定义域名。如果自定义域名是 example.com，则可以用 https://example.com/pic.jpg 访问 pic.jpg。")
            .addText(text =>
                text
                    .setPlaceholder("输入域名")
                    .setValue(this.plugin.settings.r2Setting.customDomainName)
                    .onChange(value => this.plugin.settings.r2Setting.customDomainName = value));
    }

    // Backblaze B2 设置
    private drawB2Setting(parentEL: HTMLDivElement) {
        new Setting(parentEL)
            .setName("Backblaze B2 Access Key ID")
            .setDesc("你的 Backblaze B2 Application Key ID。")
            .addText(text => text
                .setPlaceholder("输入 Application Key ID")
                .setValue(this.plugin.settings.b2Setting?.accessKeyId || '')
                .onChange(value => this.plugin.settings.b2Setting.accessKeyId = value
                ));

        new Setting(parentEL)
            .setName("Backblaze B2 Secret Access Key")
            .setDesc("你的 Backblaze B2 Application Key。")
            .addText(text => text
                .setPlaceholder("输入 Application Key")
                .setValue(this.plugin.settings.b2Setting?.secretAccessKey || '')
                .onChange(value => this.plugin.settings.b2Setting.secretAccessKey = value));

        new Setting(parentEL)
            .setName("Backblaze B2 区域")
            .setDesc("你的 Backblaze B2 区域（例如 us-west-004）。")
            .addText(text => text
                .setPlaceholder("输入区域")
                .setValue(this.plugin.settings.b2Setting?.region || '')
                .onChange(value => this.plugin.settings.b2Setting.region = value));

        new Setting(parentEL)
            .setName("Backblaze B2 Bucket 名称")
            .setDesc("你的 Backblaze B2 Bucket 名称。")
            .addText(text => text
                .setPlaceholder("输入 Bucket 名称")
                .setValue(this.plugin.settings.b2Setting?.bucketName || '')
                .onChange(value => this.plugin.settings.b2Setting.bucketName = value));

        new Setting(parentEL)
            .setName("存储路径")
            .setDesc("图片存储路径。\n支持 {year} {mon} {day} {random} {filename} 变量。例如上传 pic.jpg 时填写 /{year}/{mon}/{day}/{filename}，文件将存储为 /2023/06/08/pic.jpg。")
            .addText(text =>
                text
                    .setPlaceholder("输入路径")
                    .setValue(this.plugin.settings.b2Setting.path)
                    .onChange(value => this.plugin.settings.b2Setting.path = value));

        new Setting(parentEL)
            .setName("自定义域名")
            .setDesc("如果配置了自定义域名，则可以用 https://example.com/pic.jpg 访问 pic.jpg。否则留空使用默认 B2 URL。")
            .addText(text =>
                text
                    .setPlaceholder("输入自定义域名（可选）")
                    .setValue(this.plugin.settings.b2Setting.customDomainName)
                    .onChange(value => this.plugin.settings.b2Setting.customDomainName = value));
    }

    // ── 第二图床设置（复用各图床配置方法，通过 settings.secondXxx 访问） ──
    private async drawSecondImageStoreSettings(parentEL: HTMLDivElement) {
        parentEL.empty();
        const s = this.plugin.settings;
        switch (ImageStore.normalizeId(s.secondImageStore)) {
            case ImageStore.IMGUR.id:
                this.drawSecondImgurSetting(parentEL);
                break;
            case ImageStore.GYAZO.id:
                this.drawSecondGyazoSetting(parentEL);
                break;
            case ImageStore.ALIYUN_OSS.id:
                this.drawSecondOSSSetting(parentEL);
                break;
            case ImageStore.ImageKit.id:
                this.drawSecondImageKitSetting(parentEL);
                break;
            case ImageStore.AWS_S3.id:
                this.drawSecondAwsS3Setting(parentEL);
                break;
            case ImageStore.TENCENTCLOUD_COS.id:
                this.drawSecondTencentCloudCosSetting(parentEL);
                break;
            case ImageStore.QINIU_KUDO.id:
                this.drawSecondQiniuSetting(parentEL);
                break;
            case ImageStore.GITHUB.id:
                this.drawSecondGitHubSetting(parentEL);
                break;
            case ImageStore.CLOUDFLARE_R2.id:
                this.drawSecondR2Setting(parentEL);
                break;
            case ImageStore.BACKBLAZE_B2.id:
                this.drawSecondB2Setting(parentEL);
                break;
        }
    }

    // 第二图床：Imgur
    private drawSecondImgurSetting(parentEL: HTMLDivElement) {
        new Setting(parentEL)
            .setName("Client ID")
            .setDesc("第二图床 Imgur 的 Client ID。")
            .addText(text =>
                text
                    .setPlaceholder("输入 Client ID")
                    .setValue(this.plugin.settings.secondImgurAnonymousSetting.clientId)
                    .onChange(value => this.plugin.settings.secondImgurAnonymousSetting.clientId = value)
            )
    }

    // 第二图床：Gyazo
    private drawSecondGyazoSetting(parentEL: HTMLDivElement) {
        new Setting(parentEL)
            .setName("Access Token")
            .setDesc("第二图床 Gyazo 的 Access Token。")
            .addText(text =>
                text
                    .setPlaceholder("输入 Access Token")
                    .setValue(this.plugin.settings.secondGyazoSetting.accessToken)
                    .onChange(value => this.plugin.settings.secondGyazoSetting.accessToken = value)
            );
        new Setting(parentEL)
            .setName("访问权限")
            .setDesc("设置图片可见性。")
            .addDropdown(dd =>
                dd
                    .addOption("anyone", "所有人(anyone)")
                    .addOption("only_me", "仅我自己(only_me)")
                    .setValue(this.plugin.settings.secondGyazoSetting.accessPolicy)
                    .onChange((value: "anyone" | "only_me") => this.plugin.settings.secondGyazoSetting.accessPolicy = value)
            );
        new Setting(parentEL)
            .setName("统一描述")
            .setDesc("每次上传都会应用的固定描述。留空则不填描述字段。")
            .addText(text =>
                text
                    .setPlaceholder("输入统一描述（可选）")
                    .setValue(this.plugin.settings.secondGyazoSetting.desc)
                    .onChange(value => this.plugin.settings.secondGyazoSetting.desc = value)
            );
    }

    // 第二图床：阿里云 OSS
    private drawSecondOSSSetting(parentEL: HTMLDivElement) {
        new Setting(parentEL)
            .setName("区域")
            .setDesc("OSS 数据中心区域。")
            .addDropdown(dd =>
                dd.addOptions(AliYunRegionList)
                  .setValue(this.plugin.settings.secondOssSetting.region)
                  .onChange(value => {
                      this.plugin.settings.secondOssSetting.region = value;
                      this.plugin.settings.secondOssSetting.endpoint = `https://${value}.aliyuncs.com/`;
                  })
            );
        new Setting(parentEL)
            .setName("Access Key ID")
            .setDesc("阿里云 RAM 的 Access Key ID。")
            .addText(text =>
                text.setPlaceholder("输入 Access Key ID")
                     .setValue(this.plugin.settings.secondOssSetting.accessKeyId)
                     .onChange(value => this.plugin.settings.secondOssSetting.accessKeyId = value));
        new Setting(parentEL)
            .setName("Access Key Secret")
            .setDesc("阿里云 RAM 的 Access Key Secret。")
            .addText(text =>
                text.setPlaceholder("输入 Access Key Secret")
                     .setValue(this.plugin.settings.secondOssSetting.accessKeySecret)
                     .onChange(value => this.plugin.settings.secondOssSetting.accessKeySecret = value));
        new Setting(parentEL)
            .setName("Bucket 名称")
            .setDesc("存储图片的 Bucket 名称。")
            .addText(text =>
                text.setPlaceholder("输入 Bucket 名称")
                     .setValue(this.plugin.settings.secondOssSetting.bucket)
                     .onChange(value => this.plugin.settings.secondOssSetting.bucket = value));
        new Setting(parentEL)
            .setName("存储路径")
            .setDesc("图片存储路径。\n支持 {year} {mon} {day} {random} {filename} 变量。")
            .addText(text =>
                text.setPlaceholder("输入路径")
                     .setValue(this.plugin.settings.secondOssSetting.path)
                     .onChange(value => this.plugin.settings.secondOssSetting.path = value));
        new Setting(parentEL)
            .setName("自定义域名")
            .setDesc("如果自定义域名是 example.com，则可以用 https://example.com/pic.jpg 访问 pic.jpg。")
            .addText(text =>
                text.setPlaceholder("输入自定义域名")
                     .setValue(this.plugin.settings.secondOssSetting.customDomainName)
                     .onChange(value => this.plugin.settings.secondOssSetting.customDomainName = value));
    }

    // 第二图床：ImageKit
    private drawSecondImageKitSetting(parentEL: HTMLDivElement) {
        new Setting(parentEL)
            .setName("ImageKit ID")
            .setDesc("第二图床 ImageKit 的 ID。")
            .addText(text =>
                text.setPlaceholder("输入 ImageKit ID")
                     .setValue(this.plugin.settings.secondImagekitSetting.imagekitID)
                     .onChange(value => {
                         this.plugin.settings.secondImagekitSetting.imagekitID = value;
                         this.plugin.settings.secondImagekitSetting.endpoint = `https://ik.imagekit.io/${value}/`;
                     }));
        new Setting(parentEL)
            .setName("文件夹名称")
            .setDesc("请输入目录名称，如不需要则留空。")
            .addText(text =>
                text.setPlaceholder("输入文件夹名称")
                     .setValue(this.plugin.settings.secondImagekitSetting.folder)
                     .onChange(value => this.plugin.settings.secondImagekitSetting.folder = value));
        new Setting(parentEL)
            .setName("公钥")
            .addText(text =>
                text.setPlaceholder("输入公钥")
                     .setValue(this.plugin.settings.secondImagekitSetting.publicKey)
                     .onChange(value => this.plugin.settings.secondImagekitSetting.publicKey = value));
        new Setting(parentEL)
            .setName("私钥")
            .addText(text =>
                text.setPlaceholder("输入私钥")
                     .setValue(this.plugin.settings.secondImagekitSetting.privateKey)
                     .onChange(value => this.plugin.settings.secondImagekitSetting.privateKey = value));
    }

    // 第二图床：AWS S3
    private drawSecondAwsS3Setting(parentEL: HTMLDivElement) {
        const s = this.plugin.settings.secondAwsS3Setting;
        new Setting(parentEL)
            .setName("AWS S3 Access Key ID").setDesc("你的 AWS S3 Access Key ID。")
            .addText(text => text.setPlaceholder("输入 Access Key ID").setValue(s.accessKeyId).onChange(v => s.accessKeyId = v));
        new Setting(parentEL)
            .setName("AWS S3 Secret Access Key").setDesc("你的 AWS S3 Secret Access Key。")
            .addText(text => text.setPlaceholder("输入 Secret Access Key").setValue(s.secretAccessKey).onChange(v => s.secretAccessKey = v));
        new Setting(parentEL)
            .setName("AWS S3 区域").setDesc("你的 AWS S3 区域。")
            .addText(text => text.setPlaceholder("输入区域").setValue(s.region).onChange(v => s.region = v));
        new Setting(parentEL)
            .setName("AWS S3 Bucket 名称").setDesc("你的 AWS S3 Bucket 名称。")
            .addText(text => text.setPlaceholder("输入 Bucket 名称").setValue(s.bucketName).onChange(v => s.bucketName = v));
        new Setting(parentEL)
            .setName("存储路径").setDesc("图片存储路径。\n支持 {year} {mon} {day} {random} {filename} 变量。")
            .addText(text => text.setPlaceholder("输入路径").setValue(s.path).onChange(v => s.path = v));
        new Setting(parentEL)
            .setName("自定义域名").setDesc("如果自定义域名是 example.com，则可以用 https://example.com/pic.jpg 访问 pic.jpg。")
            .addText(text => text.setPlaceholder("输入自定义域名").setValue(s.customDomainName).onChange(v => s.customDomainName = v));
    }

    // 第二图床：腾讯云 COS
    private drawSecondTencentCloudCosSetting(parentEL: HTMLDivElement) {
        const s = this.plugin.settings.secondCosSetting;
        new Setting(parentEL)
            .setName("区域").setDesc("COS 数据中心区域。")
            .addDropdown(dd => dd.addOptions(TencentCloudRegionList).setValue(s.region).onChange(v => s.region = v));
        new Setting(parentEL)
            .setName("Secret Id").setDesc("腾讯云的 Secret Id。")
            .addText(text => text.setPlaceholder("输入 Secret Id").setValue(s.secretId).onChange(v => s.secretId = v));
        new Setting(parentEL)
            .setName("Secret Key").setDesc("腾讯云的 Secret Key。")
            .addText(text => text.setPlaceholder("输入 Secret Key").setValue(s.secretKey).onChange(v => s.secretKey = v));
        new Setting(parentEL)
            .setName("Bucket 名称").setDesc("存储图片的 Bucket 名称。")
            .addText(text => text.setPlaceholder("输入 Bucket 名称").setValue(s.bucket).onChange(v => s.bucket = v));
        new Setting(parentEL)
            .setName("存储路径").setDesc("图片存储路径。\n支持 {year} {mon} {day} {random} {filename} 变量。")
            .addText(text => text.setPlaceholder("输入路径").setValue(s.path).onChange(v => s.path = v));
        new Setting(parentEL)
            .setName("自定义域名").setDesc("如果自定义域名是 example.com，则可以用 https://example.com/pic.jpg 访问 pic.jpg。")
            .addText(text => text.setPlaceholder("输入自定义域名").setValue(s.customDomainName).onChange(v => s.customDomainName = v));
    }

    // 第二图床：七牛云
    private drawSecondQiniuSetting(parentEL: HTMLDivElement) {
        const s = this.plugin.settings.secondKodoSetting;
        new Setting(parentEL)
            .setName("Access Key").setDesc("七牛云的 Access Key。")
            .addText(text => text.setPlaceholder("输入 Access Key").setValue(s.accessKey).onChange(v => s.accessKey = v));
        new Setting(parentEL)
            .setName("Secret Key").setDesc("七牛云的 Secret Key。")
            .addText(text => text.setPlaceholder("输入 Secret Key").setValue(s.secretKey).onChange(v => s.secretKey = v));
        new Setting(parentEL)
            .setName("Bucket 名称").setDesc("存储图片的 Bucket 名称。")
            .addText(text => text.setPlaceholder("输入 Bucket 名称").setValue(s.bucket).onChange(v => s.bucket = v));
        new Setting(parentEL)
            .setName("自定义域名").setDesc("如果自定义域名是 example.com，则可以用 https://example.com/pic.jpg 访问 pic.jpg。")
            .addText(text => text.setPlaceholder("输入自定义域名").setValue(s.customDomainName).onChange(v => s.customDomainName = v));
    }

    // 第二图床：GitHub
    private drawSecondGitHubSetting(parentEL: HTMLDivElement) {
        const s = this.plugin.settings.secondGithubSetting;
        new Setting(parentEL)
            .setName("仓库名称").setDesc("存储图片的 GitHub 仓库名称（格式：owner/repo）。")
            .addText(text => text.setPlaceholder("输入仓库名称（例如 username/repo）").setValue(s.repositoryName).onChange(v => s.repositoryName = v));
        new Setting(parentEL)
            .setName("分支名称").setDesc("存储图片的分支（默认为 main）。")
            .addText(text => text.setPlaceholder("输入分支名称").setValue(s.branchName).onChange(v => s.branchName = v));
        new Setting(parentEL)
            .setName("Personal Access Token").setDesc("在 GitHub 设置页面生成具有 repo 权限的 Token。")
            .addText(text => text.setPlaceholder("输入 GitHub Token").setValue(s.token).onChange(v => s.token = v));
    }

    // 第二图床：Cloudflare R2
    private drawSecondR2Setting(parentEL: HTMLDivElement) {
        const s = this.plugin.settings.secondR2Setting;
        new Setting(parentEL)
            .setName("Cloudflare R2 Access Key ID").setDesc("你的 Cloudflare R2 Access Key ID。")
            .addText(text => text.setPlaceholder("输入 Access Key ID").setValue(s.accessKeyId).onChange(v => s.accessKeyId = v));
        new Setting(parentEL)
            .setName("Cloudflare R2 Secret Access Key").setDesc("你的 Cloudflare R2 Secret Access Key。")
            .addText(text => text.setPlaceholder("输入 Secret Access Key").setValue(s.secretAccessKey).onChange(v => s.secretAccessKey = v));
        new Setting(parentEL)
            .setName("Cloudflare R2 Endpoint").setDesc("例如 https://account-id.r2.cloudflarestorage.com。")
            .addText(text => text.setPlaceholder("输入 R2 Endpoint").setValue(s.endpoint).onChange(v => s.endpoint = v));
        new Setting(parentEL)
            .setName("Cloudflare R2 Bucket 名称").setDesc("你的 Cloudflare R2 Bucket 名称。")
            .addText(text => text.setPlaceholder("输入 Bucket 名称").setValue(s.bucketName).onChange(v => s.bucketName = v));
        new Setting(parentEL)
            .setName("存储路径").setDesc("图片存储路径。\n支持 {year} {mon} {day} {random} {filename} 变量。")
            .addText(text => text.setPlaceholder("输入路径").setValue(s.path).onChange(v => s.path = v));
        new Setting(parentEL)
            .setName("R2.dev URL / 自定义域名").setDesc("可以使用 R2.dev URL 或自定义域名。")
            .addText(text => text.setPlaceholder("输入域名").setValue(s.customDomainName).onChange(v => s.customDomainName = v));
    }

    // 第二图床：Backblaze B2
    private drawSecondB2Setting(parentEL: HTMLDivElement) {
        const s = this.plugin.settings.secondB2Setting;
        new Setting(parentEL)
            .setName("Backblaze B2 Access Key ID").setDesc("你的 Backblaze B2 Application Key ID。")
            .addText(text => text.setPlaceholder("输入 Application Key ID").setValue(s.accessKeyId).onChange(v => s.accessKeyId = v));
        new Setting(parentEL)
            .setName("Backblaze B2 Secret Access Key").setDesc("你的 Backblaze B2 Application Key。")
            .addText(text => text.setPlaceholder("输入 Application Key").setValue(s.secretAccessKey).onChange(v => s.secretAccessKey = v));
        new Setting(parentEL)
            .setName("Backblaze B2 区域").setDesc("例如 us-west-004。")
            .addText(text => text.setPlaceholder("输入区域").setValue(s.region).onChange(v => s.region = v));
        new Setting(parentEL)
            .setName("Backblaze B2 Bucket 名称").setDesc("你的 Backblaze B2 Bucket 名称。")
            .addText(text => text.setPlaceholder("输入 Bucket 名称").setValue(s.bucketName).onChange(v => s.bucketName = v));
        new Setting(parentEL)
            .setName("存储路径").setDesc("图片存储路径。\n支持 {year} {mon} {day} {random} {filename} 变量。")
            .addText(text => text.setPlaceholder("输入路径").setValue(s.path).onChange(v => s.path = v));
        new Setting(parentEL)
            .setName("自定义域名").setDesc("如果配置了自定义域名，则可以用 https://example.com/pic.jpg 访问 pic.jpg。否则留空使用默认 B2 URL。")
            .addText(text => text.setPlaceholder("输入自定义域名（可选）").setValue(s.customDomainName).onChange(v => s.customDomainName = v));
    }
}
