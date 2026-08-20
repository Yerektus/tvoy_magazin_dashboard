import { Routes } from '@angular/router';

import {
  authGuard,
  guestGuard,
  managesOrganizationGuard,
} from './features/auth/guards/auth-guard';

export const routes: Routes = [
  {
    path: 'login',
    title: 'Вход',
    canActivate: [guestGuard],
    loadComponent: () => import('./features/auth/pages/login/login').then((m) => m.Login),
  },
  { path: '', pathMatch: 'full', redirectTo: 'documents' },
  {
    path: '',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./shared/layouts/main-layout/main-layout').then((m) => m.MainLayout),
    children: [
      {
        path: 'documents',
        title: 'Документы',
        loadComponent: () =>
          import('./features/documents/pages/documents/documents').then((m) => m.Documents),
      },
      {
        path: 'documents/:id',
        title: 'Накладная',
        loadComponent: () =>
          import('./features/documents/pages/document-details/document-details').then(
            (m) => m.DocumentDetails,
          ),
      },
      {
        path: 'purchases',
        title: 'Планирование закупов',
        loadComponent: () =>
          import('./features/purchases/pages/purchases/purchases').then((m) => m.Purchases),
      },
      {
        path: 'settings',
        title: 'Расширение',
        canActivate: [managesOrganizationGuard],
        loadComponent: () =>
          import('./features/extensions/pages/extensions/extensions').then((m) => m.Extensions),
      },
      {
        path: 'settings/:slug',
        title: 'Расширение',
        canActivate: [managesOrganizationGuard],
        loadComponent: () =>
          import('./features/extensions/pages/extension-details/extension-details').then(
            (m) => m.ExtensionDetails,
          ),
      },
    ],
  },
  { path: '**', redirectTo: 'documents' },
];
