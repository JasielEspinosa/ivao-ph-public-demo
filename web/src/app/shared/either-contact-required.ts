import { ValidatorFn } from '@angular/forms';

/**
 * "Email or Number": flags a contact field while both it and its partner field are blank. Put it on both fields, and
 * re-validate each one when the other changes.
 */
export function eitherContactRequired(otherControlName: string): ValidatorFn {
  return (control) => {
    const isBlank = (value: unknown) => !String(value ?? '').trim();
    const other = control.parent?.get(otherControlName);

    return isBlank(control.value) && isBlank(other?.value) ? { contactRequired: true } : null;
  };
}
