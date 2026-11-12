/**
 * Região de erro da tela.
 *
 * A região `role="alert"` fica **sempre** no DOM, mesmo vazia: é o que
 * permite que o leitor de tela anuncie a mensagem quando ela aparece. O
 * texto vem da tabela de códigos do protocolo (regra 15: nada de mensagem
 * crua da rede).
 */
export interface ErrorBannerProps {
  readonly message: string | null;
  readonly onDismiss: () => void;
}

export function ErrorBanner({ message, onDismiss }: ErrorBannerProps) {
  return (
    <div role="alert" aria-live="assertive">
      {message === null ? null : (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border-2 border-red-800 bg-red-50 px-4 py-3 shadow-lg">
          <p className="text-sm font-semibold text-red-900">{message}</p>
          <button
            className="cnm-interactive rounded-md border border-red-800 px-2 py-1 text-sm font-semibold text-red-900"
            onClick={onDismiss}
            type="button"
          >
            Fechar aviso
          </button>
        </div>
      )}
    </div>
  );
}
