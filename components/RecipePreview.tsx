'use client';

import DOMPurify from 'dompurify';
import { slugify } from '@/lib/slugify';

interface RecipePreviewProps {
  html: string;
  title: string;
  onReset: () => void;
}

export function RecipePreview({ html, title, onReset }: RecipePreviewProps) {
  const cleanHtml = DOMPurify.sanitize(html);

  function handleDownload() {
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${slugify(title) || 'recipe'}.html`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="mt-8 border border-gray-200 rounded-2xl overflow-hidden">
      <div className="flex items-center justify-between px-6 py-3 bg-gray-50 border-b border-gray-200">
        <span className="text-sm font-medium text-gray-700 truncate mr-4">
          {title || 'Recipe'}
        </span>
        <div className="flex gap-2 shrink-0">
          <button
            onClick={handleDownload}
            className="text-sm px-4 py-1.5 bg-gray-900 text-white rounded-lg hover:bg-gray-700 transition-colors"
          >
            Download .html
          </button>
          <button
            onClick={onReset}
            className="text-sm px-4 py-1.5 border border-gray-200 rounded-lg hover:bg-gray-100 transition-colors"
          >
            Try another
          </button>
        </div>
      </div>
      <div
        className="p-6 prose max-w-none"
        dangerouslySetInnerHTML={{ __html: cleanHtml }}
      />
    </div>
  );
}
