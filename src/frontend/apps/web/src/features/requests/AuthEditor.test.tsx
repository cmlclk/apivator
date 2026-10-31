import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { emptyAuth, type RequestAuth } from '@apivator/core';
import { AuthEditor } from './AuthEditor';

function Harness({
  onChange,
  allowInherit = true,
}: {
  onChange: (a: RequestAuth) => void;
  allowInherit?: boolean;
}) {
  const [auth, setAuth] = useState(emptyAuth());
  return (
    <AuthEditor
      auth={auth}
      allowInherit={allowInherit}
      inheritedNote="Collection: Ödeme API üzerinden Bearer Token kullanılıyor."
      onChange={(a) => {
        setAuth(a);
        onChange(a);
      }}
    />
  );
}

describe('AuthEditor', () => {
  it('miras alınca kullanılacak yetkilendirmeyi anlatır', () => {
    render(<Harness onChange={() => {}} />);
    expect(screen.getByText(/Ödeme API üzerinden Bearer Token/)).toBeInTheDocument();
  });

  it('Bearer seçilince token alanı gizli gelir ve gösterilebilir', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Harness onChange={onChange} />);

    await user.selectOptions(screen.getByLabelText('Tür'), 'Bearer');
    const token = screen.getByLabelText('Token');
    expect(token).toHaveAttribute('type', 'password');

    await user.type(token, 'abc');
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: 'Bearer', bearerToken: 'abc' }),
    );

    await user.click(screen.getByRole('button', { name: 'Göster' }));
    expect(token).toHaveAttribute('type', 'text');
  });

  it('API Key query parametresine eklenebilir', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Harness onChange={onChange} />);

    await user.selectOptions(screen.getByLabelText('Tür'), 'ApiKey');
    await user.type(screen.getByLabelText('Anahtar adı'), 'api_key');
    await user.selectOptions(screen.getByLabelText('Nereye eklensin'), 'Query');

    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ apiKeyName: 'api_key', apiKeyIn: 'Query' }),
    );
  });

  it('collection için miras alma seçeneği sunulmaz', () => {
    render(<Harness onChange={() => {}} allowInherit={false} />);
    expect(screen.queryByRole('option', { name: 'Üstten miras al' })).not.toBeInTheDocument();
  });

  it('OAuth 2.0 alanları akışa göre değişir ve token paneli gösterilir', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Harness onChange={onChange} />);

    await user.selectOptions(screen.getByLabelText('Tür'), 'OAuth2');
    expect(screen.getByLabelText('Auth URL')).toBeInTheDocument();
    expect(screen.getByLabelText('Yönlendirme URI')).toHaveAttribute(
      'placeholder',
      `${window.location.origin}/oauth/callback`,
    );
    expect(screen.getByRole('status')).toHaveTextContent('yok');

    await user.selectOptions(screen.getByLabelText('Akış'), 'ClientCredentials');
    expect(screen.queryByLabelText('Auth URL')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('gönderirken otomatik alınır');

    await user.selectOptions(screen.getByLabelText('Akış'), 'Password');
    await user.type(screen.getByLabelText('Kullanıcı adı'), 'ayse');
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: 'OAuth2', oAuth2GrantType: 'Password', oAuth2Username: 'ayse' }),
    );
  });

  it('AWS Signature ve Digest alanlarını düzenler', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Harness onChange={onChange} allowInherit={false} />);

    await user.selectOptions(screen.getByLabelText('Tür'), 'AwsSigV4');
    expect(screen.getByLabelText('Bölge (region)')).toHaveValue('us-east-1');
    await user.type(screen.getByLabelText('Servis'), 's3');
    expect(screen.getByLabelText('Secret Key')).toHaveAttribute('type', 'password');
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: 'AwsSigV4', awsService: 's3' }),
    );

    await user.selectOptions(screen.getByLabelText('Tür'), 'Digest');
    await user.type(screen.getByLabelText('Kullanıcı adı'), 'u');
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: 'Digest', basicUsername: 'u' }),
    );
    expect(screen.getByText(/Digest isteği dönerse/)).toBeInTheDocument();
  });
});
