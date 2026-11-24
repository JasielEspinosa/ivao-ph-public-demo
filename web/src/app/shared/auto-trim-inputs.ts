/**
 * Trims leading/trailing spaces from every text input and textarea on every page, as soon as the user
 * leaves the field (click away, Tab, ...) or submits a form with Enter, so saved data never carries
 * extra spaces at the start or end.
 *
 * - Password fields are left alone (spaces can be part of a password), including ones whose show/hide toggle
 *   temporarily switches them to type="text" (detected by a "password" form control name, id, name or autocomplete).
 * - Add `data-no-trim` to a field (or a parent element) to opt it out.
 * - After trimming, an `input` event is dispatched so Angular forms and any `(input)` handlers see the new value.
 */

const TRIMMED_INPUT_TYPES = new Set(['text', 'search', 'email', 'tel', 'url']);

function looksLikePassword(field: HTMLInputElement | HTMLTextAreaElement): boolean {
  return ['formcontrolname', 'id', 'name', 'autocomplete'].some((attribute) =>
    /password/i.test(field.getAttribute(attribute) ?? ''),
  );
}

function isTrimmable(target: EventTarget | null): target is HTMLInputElement | HTMLTextAreaElement {
  if (target instanceof HTMLTextAreaElement) {
    return !target.readOnly && !target.disabled && !target.closest('[data-no-trim]');
  }

  if (target instanceof HTMLInputElement) {
    return (
      TRIMMED_INPUT_TYPES.has(target.type) &&
      !target.readOnly &&
      !target.disabled &&
      !looksLikePassword(target) &&
      !target.closest('[data-no-trim]')
    );
  }

  return false;
}

function trimField(field: HTMLInputElement | HTMLTextAreaElement): void {
  const trimmed = field.value.trim();
  if (trimmed === field.value) {
    return;
  }

  field.value = trimmed;
  field.dispatchEvent(new Event('input', { bubbles: true }));
}

/** Starts the app-wide trimming. Returns a function that stops it. */
export function installAutoTrimInputs(): () => void {
  const onFocusOut = (event: FocusEvent): void => {
    if (isTrimmable(event.target)) {
      trimField(event.target);
    }
  };

  // Capture phase: runs before the form's own submit handler, so Enter-to-submit saves trimmed values too.
  const onSubmit = (event: Event): void => {
    if (!(event.target instanceof HTMLFormElement)) {
      return;
    }

    for (const element of Array.from(event.target.elements)) {
      if (isTrimmable(element)) {
        trimField(element);
      }
    }
  };

  document.addEventListener('focusout', onFocusOut);
  document.addEventListener('submit', onSubmit, true);

  return () => {
    document.removeEventListener('focusout', onFocusOut);
    document.removeEventListener('submit', onSubmit, true);
  };
}
