import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { RouteError } from './RouteError';

function Boom(): never {
  throw new TypeError("Cannot read properties of undefined (reading 'type')");
}

describe('RouteError', () => {
  it('beklenmeyen hatada anlaşılır sayfa ve çözüm seçenekleri gösterir', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const router = createMemoryRouter([{ path: '/', element: <Boom />, errorElement: <RouteError /> }]);
    render(<RouterProvider router={router} />);

    expect(screen.getByRole('heading', { name: 'Bir şeyler ters gitti' })).toBeInTheDocument();
    expect(screen.getByText(/reading 'type'/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Açık sekmeleri sıfırla' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sayfayı yenile' })).toBeInTheDocument();
  });
});
