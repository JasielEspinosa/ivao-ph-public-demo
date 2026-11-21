export const VALIDATION_MESSAGES = {
  required: 'This field is required.',
  emailMaxLength: 'Email address must not exceed 255 characters.',
  futureDate: 'Date must not be in the future.',
  futureYear: 'Year must not exceed the current year.',
  invalidPhilippineContactNumber: 'Enter a valid Philippine mobile or landline number.',
  invalidPhilippineLandline: 'Enter a valid Philippine landline number.',
  invalidEmail: 'Please enter a valid email address.',
  invalidName: 'Enter a valid name',
  invalidPhilippineMobile: 'Enter a valid Philippine mobile number.',
  invalidSuffix: 'Enter a valid suffix (Jr., Sr., I, II, III, IV, V, VI, VII, VIII, IX, X).',
  invalidSuffixShort: 'Enter a valid suffix',
  invalidYear: 'Enter a valid 4-digit year.',
} as const;
