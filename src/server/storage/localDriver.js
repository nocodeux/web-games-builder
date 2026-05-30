import fs from 'fs';
import path from 'path';

function uploadsDir() {
  return path.resolve(process.cwd(), process.env.STORAGE_PATH || './uploads');
}

export const localDriver = {
  async upload(buffer, filename, _mimeType) {
    const dir = uploadsDir();
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, filename), buffer);
    // Local storage must return the local static route. If CDN_BASE_URL points
    // at the PaaS bucket while STORAGE_DRIVER=local, uploads succeed on disk
    // but the editor tries to render a remote URL where the file does not exist.
    const cdn = process.env.NODE_ENV === 'production' ? process.env.CDN_BASE_URL : null;
    const url = cdn ? `${cdn.replace(/\/$/, '')}/${filename}` : `/uploads/${filename}`;
    return { url, key: `uploads/${filename}` };
  },

  async delete(key) {
    const filename = key.replace(/^uploads\//, '');
    const fp = path.join(uploadsDir(), filename);
    if (fs.existsSync(fp)) fs.unlinkSync(fp);
  },
};
