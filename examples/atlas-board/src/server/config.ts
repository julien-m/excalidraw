import { homedir, platform } from "node:os";
import { join, resolve } from "node:path";

export const dataDirectory = resolve(
  process.env.ATLAS_BOARD_DATA_DIR ??
    (platform() === "darwin"
      ? join(homedir(), "Library", "Application Support", "Atlas Board")
      : join(
          process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share"),
          "atlas-board",
        )),
);
export const runtimePath = join(dataDirectory, "runtime.json");
