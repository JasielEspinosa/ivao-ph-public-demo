export const VALIDATION_PATTERNS = {
  email: '^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$',
  mobileNumber_ph: '^\\+63 9[0-9]{2} [0-9]{3} [0-9]{4}$',
  contactNumber_ph: '^(?:(?:0|\\+63)(?:9[0-9]{9}|[2-9][0-9]{8})|9[0-9]{9})$',
  landlineNumber_ph: '^(?:0|\\+63)[2-9][0-9]{8}$',
  personName: "^[A-Za-z]+(?:[ .'-][A-Za-z]+)*$",
  personNameFull: "^[A-Za-z]+\\.?(?:[ '-][A-Za-z]+\\.?)*$",
  personNameDisallowedChars: "[^A-Za-z .'-]",
  suffix: '^(?:[Jj][Rr]\\.?|[Ss][Rr]\\.?|I|II|III|IV|V|VI|VII|VIII|IX|X)$',
  year: '^\\d{4}$',
} as const;
