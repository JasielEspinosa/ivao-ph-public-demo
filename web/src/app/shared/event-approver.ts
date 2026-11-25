/**
 * Whether a staff member approves new events. One setting of the member, edited on both the Members page and the Manage
 * User page ("Add to Member List"). The built-in "admin" user can also be set on the Manage User page without being staff.
 */
export type ApproverType = 'NONE' | 'REQUIRED' | 'OPTIONAL';

/** The setting the form's two toggles stand for; only staff and the built-in admin can be approvers. */
export function toApproverType(canBeApprover: boolean, isRequired: boolean, isOptional: boolean): ApproverType {
  if (!canBeApprover) {
    return 'NONE';
  }
  if (isRequired) {
    return 'REQUIRED';
  }
  return isOptional ? 'OPTIONAL' : 'NONE';
}
