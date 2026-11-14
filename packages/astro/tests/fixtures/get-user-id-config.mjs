// A configModule fixture that also exports getUserId.
export default { apiKey: 'sdk_runtime' };
export function getUserId({ locals }) {
  return locals.user?.id;
}
