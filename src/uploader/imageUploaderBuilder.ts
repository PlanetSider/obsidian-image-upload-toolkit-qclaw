import {PublishSettings} from "../publish";
import ImageUploader from "./imageUploader";
import ImageStore from "../imageStore";

/**
 * Build an ImageUploader from settings.
 * If storeId is provided, build from the "second" settings group (for second store).
 * Otherwise build from the primary settings.
 */
export default function buildUploader(settings: PublishSettings, storeId?: string): ImageUploader {
    const id = storeId ?? settings.imageStore;
    switch (ImageStore.normalizeId(id)) {
        case ImageStore.IMGUR.id: {
            const {default: ImgurAnonymousUploader} = require("./imgur/imgurAnonymousUploader");
            const clientId = storeId ? settings.secondImgurAnonymousSetting.clientId : settings.imgurAnonymousSetting.clientId;
            return new ImgurAnonymousUploader(clientId);
        }
        case ImageStore.GYAZO.id: {
            const {default: GyazoUploader} = require("./gyazo/gyazoUploader");
            const s = storeId ? settings.secondGyazoSetting : settings.gyazoSetting;
            return new GyazoUploader(s);
        }
        case ImageStore.ALIYUN_OSS.id: {
            const {default: OssUploader} = require("./oss/ossUploader");
            const s = storeId ? settings.secondOssSetting : settings.ossSetting;
            return new OssUploader(s);
        }
        case ImageStore.ImageKit.id: {
            const {default: ImagekitUploader} = require("./imagekit/imagekitUploader");
            const s = storeId ? settings.secondImagekitSetting : settings.imagekitSetting;
            return new ImagekitUploader(s);
        }
        case ImageStore.AWS_S3.id: {
            const {default: AwsS3Uploader} = require("./s3/awsS3Uploader");
            const s = storeId ? settings.secondAwsS3Setting : settings.awsS3Setting;
            return new AwsS3Uploader(s);
        }
        case ImageStore.TENCENTCLOUD_COS.id: {
            const {default: CosUploader} = require("./cos/cosUploader");
            const s = storeId ? settings.secondCosSetting : settings.cosSetting;
            return new CosUploader(s);
        }
        case ImageStore.QINIU_KUDO.id: {
            const {default: KodoUploader} = require("./qiniu/kodoUploader");
            const s = storeId ? settings.secondKodoSetting : settings.kodoSetting;
            return new KodoUploader(s);
        }
        case ImageStore.GITHUB.id: {
            const {default: GitHubUploader} = require("./github/gitHubUploader");
            const s = storeId ? settings.secondGithubSetting : settings.githubSetting;
            return new GitHubUploader(s);
        }
        case ImageStore.CLOUDFLARE_R2.id: {
            const {default: R2Uploader} = require("./r2/r2Uploader");
            const s = storeId ? settings.secondR2Setting : settings.r2Setting;
            return new R2Uploader(s);
        }
        case ImageStore.BACKBLAZE_B2.id: {
            const {default: B2Uploader} = require("./b2/b2Uploader");
            const s = storeId ? settings.secondB2Setting : settings.b2Setting;
            return new B2Uploader(s);
        }
        default:
            throw new Error('should not reach here!')
    }
}
