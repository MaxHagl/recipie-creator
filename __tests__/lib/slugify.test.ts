import { slugify } from '@/lib/slugify';

describe('slugify', () => {
  it('lowercases and replaces spaces with hyphens', () => {
    expect(slugify('Pasta Carbonara')).toBe('pasta-carbonara');
  });

  it('removes special characters', () => {
    expect(slugify('Grandma\'s #1 Soup!')).toBe('grandmas-1-soup');
  });

  it('collapses multiple hyphens', () => {
    expect(slugify('chicken   &   rice')).toBe('chicken-rice');
  });

  it('trims leading and trailing hyphens', () => {
    expect(slugify('  -recipe-  ')).toBe('recipe');
  });

  it('returns "recipe" for empty or whitespace-only input', () => {
    expect(slugify('')).toBe('recipe');
    expect(slugify('   ')).toBe('recipe');
  });

  it('handles emoji and unicode gracefully', () => {
    expect(slugify('🍝 Pasta')).toBe('pasta');
  });
});
