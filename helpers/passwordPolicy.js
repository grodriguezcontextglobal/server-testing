/**
 * Longitud mínima de contraseña de staff (FedRAMP IA-5, NIST 800-63B).
 *
 * Se aplica al CREAR o CAMBIAR una contraseña, nunca al login: las cuentas con
 * una contraseña anterior más corta siguen entrando, y la siguiente vez que la
 * cambien ya tendrá que cumplir.
 */
const MIN_PASSWORD_LENGTH = (() => {
  const n = Number(process.env.PASSWORD_MIN_LENGTH);
  return Number.isInteger(n) && n >= 8 ? n : 12;
})();

const MAX_PASSWORD_LENGTH = 128;

const isAcceptablePassword = (password) =>
  typeof password === "string" &&
  password.length >= MIN_PASSWORD_LENGTH &&
  password.length <= MAX_PASSWORD_LENGTH;

const passwordPolicyMessage = `Password must have between ${MIN_PASSWORD_LENGTH} and ${MAX_PASSWORD_LENGTH} characters.`;

module.exports = {
  MIN_PASSWORD_LENGTH,
  MAX_PASSWORD_LENGTH,
  isAcceptablePassword,
  passwordPolicyMessage,
};
