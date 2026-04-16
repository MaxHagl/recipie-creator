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
const DOWNLOAD_MAX_ATTEMPTS = 3;
const UPLOAD_MAX_ATTEMPTS = 3;
const GEMINI_READY_MAX_ATTEMPTS = 2;
const RETRY_BASE_DELAY_MS = 1_000;

type VideoPipelineStage = 'download' | 'upload' | 'gemini-video';

function getErrorReason(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  return 'Unknown error';
}

function getErrorStatus(error: unknown): number | undefined {
  if (
    typeof error === 'object' &&
    error !== null &&
    'status' in error &&
    typeof (error as { status?: unknown }).status === 'number'
  ) {
    return (error as { status: number }).status;
  }

  return undefined;
}

function isRetryableStatus(status: number | undefined): boolean {
  if (status === undefined) {
    return true;
  }

  return status === 408 || status === 429 || status >= 500;
}

function shouldRetryStage(stage: VideoPipelineStage, error: unknown): boolean {
  const status = getErrorStatus(error);
  if (!isRetryableStatus(status)) {
    return false;
  }

  if (!(error instanceof Error)) {
    return true;
  }

  const message = error.message.toLowerCase();
  if (message.includes('processing failed')) {
    return false;
  }

  if (stage === 'download') {
    return (
      message.includes('failed to download video') ||
      message.includes('timed out') ||
      message.includes('network') ||
      message.includes('unavailable')
    );
  }

  if (stage === 'upload') {
    return (
      message.includes('timed out') ||
      message.includes('network') ||
      message.includes('unavailable') ||
      message.includes('upload')
    );
  }

  return (
    message.includes('timed out') ||
    message.includes('network') ||
    message.includes('unavailable') ||
    message.includes('processing')
  );
}

async function runWithRetry<T>(
  stage: VideoPipelineStage,
  maxAttempts: number,
  task: () => Promise<T>
): Promise<T> {
  let attempt = 0;

  while (attempt < maxAttempts) {
    attempt += 1;

    try {
      return await task();
    } catch (error) {
      const retrying = attempt < maxAttempts && shouldRetryStage(stage, error);
      console.warn('[videoProcessor] stage warning', {
        stage,
        attempt,
        maxAttempts,
        retrying,
        reason: getErrorReason(error),
      });

      if (!retrying) {
        throw error;
      }

      await sleep(RETRY_BASE_DELAY_MS * attempt);
    }
  }

  throw new Error(`Unexpected retry failure in stage "${stage}"`);
}

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
  const buffer = await runWithRetry('download', DOWNLOAD_MAX_ATTEMPTS, async () => {
    const response = await fetch(videoUrl, { headers: INSTAGRAM_VIDEO_HEADERS });
    if (!response.ok) {
      const status = Number(response.status);
      const error = new Error(
        Number.isFinite(status)
          ? `Failed to download video (status ${status})`
          : 'Failed to download video'
      );
      if (Number.isFinite(status)) {
        (error as { status?: number }).status = status;
      }
      throw error;
    }

    return Buffer.from(await response.arrayBuffer());
  });
  const tempPath = path.join(os.tmpdir(), `reel-${crypto.randomBytes(8).toString('hex')}.mp4`);

  await fs.writeFile(tempPath, buffer);

  const fileManager = new GoogleAIFileManager(process.env.GEMINI_API_KEY!);

  try {
    const uploadResult = await runWithRetry('upload', UPLOAD_MAX_ATTEMPTS, async () =>
      fileManager.uploadFile(tempPath, {
        mimeType: 'video/mp4',
        displayName: 'instagram-reel',
      })
    );

    await runWithRetry('gemini-video', GEMINI_READY_MAX_ATTEMPTS, async () =>
      waitForFileToBeReady(fileManager, uploadResult.file.name)
    );

    return {
      fileUri: uploadResult.file.uri,
      mimeType: uploadResult.file.mimeType,
    };
  } finally {
    await fs.unlink(tempPath).catch(() => {});
  }
}
