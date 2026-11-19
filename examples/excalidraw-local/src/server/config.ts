import { homedir, platform } from "node:os";
import { join, resolve } from "node:path";

export const dataDirectory = resolve(
  process.env.EXCALIDRAW_LOCAL_DATA_DIR ??
    (platform() === "darwin"
      ? join(homedir(), "Library", "Application Support", "Excalidraw Local")
      : join(
          process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share"),
          "excalidraw-local",
        )),
);
export const runtimePath = join(dataDirectory, "runtime.json");
