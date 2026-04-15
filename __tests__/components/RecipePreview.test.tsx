/**
 * @jest-environment jsdom
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { RecipePreview } from '@/components/RecipePreview';

// dompurify needs the DOM — mock it to return input unchanged in tests
jest.mock('dompurify', () => ({
  sanitize: (html: string) => html,
}));

const mockOnReset = jest.fn();

// Mock URL.createObjectURL and revokeObjectURL
global.URL.createObjectURL = jest.fn().mockReturnValue('blob:fake');
global.URL.revokeObjectURL = jest.fn();

describe('RecipePreview', () => {
  afterEach(() => jest.clearAllMocks());

  it('renders recipe title in header', () => {
    render(
      <RecipePreview html="<h1>Pasta</h1>" title="Pasta" onReset={mockOnReset} />
    );
    expect(screen.getByText('Pasta')).toBeInTheDocument();
  });

  it('renders HTML content', () => {
    render(
      <RecipePreview
        html="<p data-testid='content'>Ingredients</p>"
        title="Test"
        onReset={mockOnReset}
      />
    );
    expect(screen.getByTestId('content')).toBeInTheDocument();
  });

  it('calls onReset when Try another is clicked', () => {
    render(
      <RecipePreview html="<h1>Soup</h1>" title="Soup" onReset={mockOnReset} />
    );
    fireEvent.click(screen.getByRole('button', { name: /try another/i }));
    expect(mockOnReset).toHaveBeenCalled();
  });

  it('triggers download when Download button is clicked', () => {
    const clickSpy = jest.fn();
    const mockAnchor = { href: '', download: '', click: clickSpy } as unknown as HTMLAnchorElement;
    jest.spyOn(document, 'createElement').mockImplementationOnce((tag) => {
      if (tag === 'a') return mockAnchor;
      return document.createElement(tag);
    });

    render(
      <RecipePreview html="<h1>Pasta Carbonara</h1>" title="Pasta Carbonara" onReset={mockOnReset} />
    );
    fireEvent.click(screen.getByRole('button', { name: /download/i }));
    expect(clickSpy).toHaveBeenCalled();
    expect(mockAnchor.download).toBe('pasta-carbonara.html');
  });
});
