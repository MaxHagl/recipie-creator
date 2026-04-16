'use client';

import { useState } from 'react';
import { RecipeForm } from './RecipeForm';
import { RecipePreview } from './RecipePreview';

interface RecipeResult {
  html: string;
  title: string;
}

export function AppPage() {
  const [result, setResult] = useState<RecipeResult | null>(null);

  return (
    <main className="min-h-screen bg-gray-50 py-12 px-4">
      <div className="mx-auto w-full max-w-3xl">
        <h1 className="text-2xl font-semibold text-gray-900 sm:text-3xl">
          Recipe Creator
        </h1>
        <p className="mt-2 text-sm text-gray-500">
          Paste an Instagram Post or Reel URL to extract a recipe and download it
          as an HTML file.
        </p>

        <section className="mt-8 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm sm:p-6">
          <RecipeForm
            onResult={(html, title) => {
              setResult({ html, title });
            }}
          />
          {result && (
            <RecipePreview
              html={result.html}
              title={result.title}
              onReset={() => setResult(null)}
            />
          )}
        </section>
      </div>
    </main>
  );
}
