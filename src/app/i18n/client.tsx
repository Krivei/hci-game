'use client';

import { initReactI18next } from 'react-i18next';
import i18next from 'i18next';
import resourcesToBackend from 'i18next-resources-to-backend';
import { getOptions } from './settings';


i18next
  .use(initReactI18next)
  .use(
    resourcesToBackend((language: string) => {
      return import(`../../../public/locales/${language}.json`);
    })
  )
  .init({
    ...getOptions(),
    detection: { order: ['path', 'navigator'] },
  });

export default i18next;