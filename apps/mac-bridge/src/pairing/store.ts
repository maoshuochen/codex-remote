import fs from "node:fs";
import path from "node:path";

export type TrustedDevice = {
  deviceId: string;
  deviceName: string;
  publicKey: string;
  pairedAt: string;
};

type TrustStoreData = {
  devices: TrustedDevice[];
};

export class TrustStore {
  constructor(private readonly filePath: string) {}

  list(): TrustedDevice[] {
    return this.read().devices;
  }

  get(deviceId: string): TrustedDevice | undefined {
    return this.read().devices.find((device) => device.deviceId === deviceId);
  }

  put(device: TrustedDevice): void {
    const current = this.read();
    const devices = current.devices.filter((item) => item.deviceId !== device.deviceId);
    devices.push(device);
    this.write({ devices });
  }

  clear(): void {
    this.write({ devices: [] });
  }

  private read(): TrustStoreData {
    if (!fs.existsSync(this.filePath)) {
      return { devices: [] };
    }

    try {
      return JSON.parse(fs.readFileSync(this.filePath, "utf8")) as TrustStoreData;
    } catch {
      return { devices: [] };
    }
  }

  private write(data: TrustStoreData): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const directory = path.dirname(this.filePath);
    const tempPath = path.join(directory, `${path.basename(this.filePath)}.${process.pid}.tmp`);
    fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), "utf8");
    fs.renameSync(tempPath, this.filePath);
  }
}
