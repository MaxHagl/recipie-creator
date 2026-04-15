import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { GoogleAIFileManager } from '@google/generative-ai/server';

export interface VideoUploadResult {
  fileUri: string;
  mimeType: string;
}

export async function uploadVideoToGemini(videoUrl: string): Promise<VideoUploadResult> {
  const response = await fetch(videoUrl);
  if (!response.ok) throw new Error('Failed to download video');

  const buffer = Buffer.from(await response.arrayBuffer());
  const tempPath = path.join(os.tmpdir(), `reel-${Date.now()}.mp4`);

  await fs.writeFile(tempPath, buffer);

  const fileManager = new GoogleAIFileManager(process.env.GEMINI_API_KEY!);

  try {
    const uploadResult = await fileManager.uploadFile(tempPath, {
      mimeType: 'video/mp4',
      displayName: 'instagram-reel',
    });
    return {
      fileUri: uploadResult.file.uri,
      mimeType: uploadResult.file.mimeType,
    };
  } finally {
    await fs.unlink(tempPath).catch(() => {});
  }
}
