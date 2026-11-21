const DEFAULT_INVALID_SELECTOR =
  '.universal-file-input.file-invalid, input.ng-invalid, textarea.ng-invalid, select.ng-invalid, .uf-error';

const DEFAULT_CONTAINER_SELECTOR = 'label, .choice-field, .universal-form-block, .universal-upload-panel, .content-row';

export function scrollToFirstValidationError(
  document: Document,
  options?: {
    formSelector?: string;
    invalidSelector?: string;
    containerSelector?: string;
  },
): void {
  const formSelector = options?.formSelector ?? 'form.universal-form';
  const invalidSelector = options?.invalidSelector ?? DEFAULT_INVALID_SELECTOR;
  const containerSelector = options?.containerSelector ?? DEFAULT_CONTAINER_SELECTOR;

  setTimeout(() => {
    const formElement = document.querySelector(formSelector);

    if (!formElement) {
      return;
    }

    const candidates = Array.from(formElement.querySelectorAll<HTMLElement>(invalidSelector));

    const firstInvalidElement = candidates[0];

    if (!firstInvalidElement) {
      return;
    }

    firstInvalidElement.scrollIntoView({ behavior: 'smooth', block: 'center' });

    const focusTarget = resolveFocusTarget(firstInvalidElement, containerSelector);
    focusTarget?.focus({ preventScroll: true });
  });
}

export function resolveFocusTarget(
  element: HTMLElement,
  containerSelector = DEFAULT_CONTAINER_SELECTOR,
): HTMLElement | null {
  if (isFocusable(element)) {
    return element;
  }

  const container = element.closest(containerSelector);
  if (!container) {
    return null;
  }

  return container.querySelector<HTMLElement>('input, textarea, select');
}

export function isFocusable(
  element: HTMLElement,
): element is HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement {
  return (
    element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement ||
    element instanceof HTMLSelectElement
  );
}
