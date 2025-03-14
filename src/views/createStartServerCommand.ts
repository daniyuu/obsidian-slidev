import spawn from "cross-spawn";
import path from "node:path";
import type { App } from "obsidian";
import type { SlidevPluginSettings } from "../SlidevSettingTab";
import { getVaultPath } from "../utils/getVaultPath";

export function createStartServerCommand({
  app,
  config,
}: {
  app: App;
  config: SlidevPluginSettings;
}) {
  const vaultPath = getVaultPath(app.vault);

  const templatePath = config.slidevTemplateLocation;

  const activeFile = app.workspace.getActiveFile();
  const currentSlideFilePath = activeFile == null ? "" : activeFile.path;

  const slidePathRelativeToTemplatePath = path.join(
    vaultPath,
    currentSlideFilePath,
  );

  // On Windows, we need to use a different approach
  const isWindows = process.platform === "win32";
  
  if (isWindows) {
    // For Windows, use npx to run slidev and specify the command and arguments separately
    // This prevents the immediate exit issue
    const command = "slidev";
    
    // Wrap the path in quotes to handle paths with hyphens or spaces
    const quotedPath = `"${slidePathRelativeToTemplatePath}"`;
    
    const args = [
      quotedPath,
      "--",
      "--port",
      config.port.toString(),
      "--open"
    ];
    
    return spawn(command, args, {
      env: process.env,
      shell: true,
      cwd: templatePath,
      windowsHide: false, // Make sure the process window is not hidden on Windows
      detached: false     // Don't detach the process on Windows
    });
  } else {
    // Original approach for non-Windows platforms
    const codeBlockContent = [
      // This makes node & npm usable
      config.initialScript,
      `cd ${templatePath}`,
      // If you use npm scripts, don't forget to add -- after the npm command:
      `npm run slidev "${slidePathRelativeToTemplatePath}" --port ${config.port}`,
    ].join("\n");

    return spawn(codeBlockContent, [], {
      env: process.env,
      shell: true,
      cwd: templatePath,
    });
  }
}
