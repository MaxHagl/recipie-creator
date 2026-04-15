/**
 * @jest-environment jsdom
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { RecipeForm } from '@/components/RecipeForm';

global.fetch = jest.fn();
const mockFetch = global.fetch as jest.Mock;
const mockOnResult = jest.fn();

describe('RecipeForm', () => {
  afterEach(() => jest.clearAllMocks());

  it('renders URL input and submit button', () => {
    render(<RecipeForm onResult={mockOnResult} />);
    expect(screen.getByPlaceholderText(/instagram/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /extract recipe/i })).toBeInTheDocument();
  });

  it('submit button is disabled when input is empty', () => {
    render(<RecipeForm onResult={mockOnResult} />);
    expect(screen.getByRole('button', { name: /extract recipe/i })).toBeDisabled();
  });

  it('calls onResult with html and title on success', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({ html: '<h1>Pasta</h1>', title: 'Pasta' }),
    });

    render(<RecipeForm onResult={mockOnResult} />);
    fireEvent.change(screen.getByPlaceholderText(/instagram/i), {
      target: { value: 'https://www.instagram.com/p/abc/' },
    });
    fireEvent.click(screen.getByRole('button', { name: /extract recipe/i }));

    await waitFor(() =>
      expect(mockOnResult).toHaveBeenCalledWith('<h1>Pasta</h1>', 'Pasta')
    );
  });

  it('shows error message on API failure', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      json: jest.fn().mockResolvedValue({ error: 'Invalid Instagram URL' }),
    });

    render(<RecipeForm onResult={mockOnResult} />);
    fireEvent.change(screen.getByPlaceholderText(/instagram/i), {
      target: { value: 'https://www.instagram.com/p/abc/' },
    });
    fireEvent.click(screen.getByRole('button', { name: /extract recipe/i }));

    await waitFor(() =>
      expect(screen.getByText(/invalid instagram url/i)).toBeInTheDocument()
    );
    expect(mockOnResult).not.toHaveBeenCalled();
  });
});
