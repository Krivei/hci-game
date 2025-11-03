export const supportedLngs = ['en', 'de', 'cn'];

export function getOptions(lang = 'en') {
  return {
    supportedLngs,
    fallbackLng: 'en',
    lng: lang,
  };
}