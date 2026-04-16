'use client';

import { useState } from 'react';

interface RecipeFormProps {
  onResult: (html: string, title: string) => void;
}

const STATUSES = ['Fetching page…', 'Processing with AI…'];

export function RecipeForm({ onResult }: RecipeFormProps) {
  const [url, setUrl] = useState('');
  const [dateNightMode, setDateNightMode] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [statusIdx, setStatusIdx] = useState(0);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    setStatusIdx(0);

    const timer = setTimeout(() => setStatusIdx(1), 8_000);

    try {
      const res = await fetch('/api/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, dateNightMode }),
      });

      const data = await res.json();

      if (res.ok) {
        onResult(data.html, data.title);
        setUrl('');
        setDateNightMode(false);
      } else {
        setError(data.error ?? 'Something went wrong.');
      }
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      clearTimeout(timer);
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="flex gap-2">
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://www.instagram.com/reel/…"
          className="flex-1 px-4 py-2 rounded-lg border border-gray-200 focus:outline-none focus:ring-2 focus:ring-gray-400 text-sm"
        />
        <button
          type="submit"
          disabled={loading || !url}
          className="px-5 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-700 disabled:opacity-50 whitespace-nowrap text-sm transition-colors"
        >
          {loading ? 'Working…' : 'Extract Recipe'}
        </button>
      </div>
      <label className="inline-flex items-center gap-2 text-sm text-gray-600">
        <input
          type="checkbox"
          checked={dateNightMode}
          onChange={(e) => setDateNightMode(e.target.checked)}
          className="h-4 w-4 rounded border-gray-300 text-gray-900 focus:ring-gray-400"
        />
        Date Night mode (Max + Franca)
      </label>
      {loading && (
        <p className="text-gray-400 text-sm">{STATUSES[statusIdx]}</p>
      )}
      {error && <p className="text-red-500 text-sm">{error}</p>}
    </form>
  );
}
