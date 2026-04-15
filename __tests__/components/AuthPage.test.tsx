/**
 * @jest-environment jsdom
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AuthPage } from '@/components/AuthPage';

const mockRefresh = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mockRefresh }),
}));

global.fetch = jest.fn();
const mockFetch = global.fetch as jest.Mock;

describe('AuthPage', () => {
  afterEach(() => jest.clearAllMocks());

  it('renders password input and submit button', () => {
    render(<AuthPage />);
    expect(screen.getByPlaceholderText(/password/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /enter/i })).toBeInTheDocument();
  });

  it('calls router.refresh() on successful auth', async () => {
    mockFetch.mockResolvedValue({ ok: true });
    render(<AuthPage />);
    fireEvent.change(screen.getByPlaceholderText(/password/i), {
      target: { value: 'secret' },
    });
    fireEvent.click(screen.getByRole('button', { name: /enter/i }));
    await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
    expect(screen.getByRole('button', { name: /enter/i })).not.toBeDisabled();
  });

  it('shows error message on failed auth', async () => {
    mockFetch.mockResolvedValue({ ok: false });
    render(<AuthPage />);
    fireEvent.change(screen.getByPlaceholderText(/password/i), {
      target: { value: 'wrong' },
    });
    fireEvent.click(screen.getByRole('button', { name: /enter/i }));
    await waitFor(() =>
      expect(screen.getByText(/invalid password/i)).toBeInTheDocument()
    );
  });
});
