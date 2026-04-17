import {App, TFile} from "obsidian";

const FAILURE_LOG_FILE = "upload-failures.md";

export interface FailureEntry {
    notePath: string;
    imageName: string;
    error: string;
    timestamp: string;
}

/**
 * Append failure records to upload-failures.md in vault root.
 * Creates the file with a header if it doesn't exist.
 * Each new run appends entries under a new timestamped section.
 */
export async function logUploadFailures(app: App, entries: FailureEntry[]): Promise<void> {
    if (entries.length === 0) return;

    const adapter = app.vault.adapter;
    let existing = "";
    try {
        existing = await adapter.read(FAILURE_LOG_FILE);
    } catch {
        // File doesn't exist yet — will create below
    }

    const now = new Date();
    const timestamp = now.toLocaleString("zh-CN", {timeZone: "Asia/Shanghai"});

    const lines: string[] = [
        existing.trim(),
        "",
        `## 上传失败记录 — ${timestamp}`,
        "",
    ];

    for (const entry of entries) {
        lines.push(`- **笔记**: ${entry.notePath}  |  **图片**: ${entry.imageName}  |  **错误**: ${entry.error}`);
    }

    await adapter.write(FAILURE_LOG_FILE, lines.join("\n") + "\n");
}
