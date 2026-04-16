import crypto from 'crypto';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { FileState, GoogleAIFileManager } from '@google/generative-ai/server';

export interface VideoUploadResult {
  fileUri: string;
  mimeType: string;
}

const INSTAGRAM_VIDEO_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Referer: 'https://www.instagram.com/',
};
const FILE_READY_TIMEOUT_MS = 45_000;
const FILE_READY_POLL_MS = 1_500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForFileToBeReady(
  fileManager: GoogleAIFileManager,
  fileName: string
): Promise<void> {
  const deadline = Date.now() + FILE_READY_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const file = await fileManager.getFile(fileName);

    if (file.state === FileState.ACTIVE) {
      return;
    }

    if (file.state === FileState.FAILED) {
      const errMessage = file.error?.message ?? 'Unknown Gemini file processing error';
      throw new Error(`Gemini file processing failed: ${errMessage}`);
    }

    await sleep(FILE_READY_POLL_MS);
  }

  throw new Error('Timed out waiting for Gemini to finish processing video');
}

export async function uploadVideoToGemini(videoUrl: string): Promise<VideoUploadResult> {
  const response = await fetch(videoUrl, { headers: INSTAGRAM_VIDEO_HEADERS });
  if (!response.ok) throw new Error('Failed to download video');

  const buffer = Buffer.from(await response.arrayBuffer());
  const tempPath = path.join(os.tmpdir(), `reel-${crypto.randomBytes(8).toString('hex')}.mp4`);

  await fs.writeFile(tempPath, buffer);

  const fileManager = new GoogleAIFileManager(process.env.GEMINI_API_KEY!);

  try {
    const uploadResult = await fileManager.uploadFile(tempPath, {
      mimeType: 'video/mp4',
      displayName: 'instagram-reel',
    });

    await waitForFileToBeReady(fileManager, uploadResult.file.name);

    return {
      fileUri: uploadResult.file.uri,
      mimeType: uploadResult.file.mimeType,
    };
  } finally {
    await fs.unlink(tempPath).catch(() => {});
  }
}
