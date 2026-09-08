import { Routes } from '@angular/router';

import {
  authGuard,
  guestGuard,
  homeGuard,
  managesOrganizationGuard,
} from './features/auth/guards/auth-guard';

export const routes: Routes = [
  {
    path: 'login',
    title: 'Вход',
    canActivate: [guestGuard],
    loadComponent: () => import('./features/auth/pages/login/login').then((m) => m.Login),
  },
  {
    path: '',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./shared/layouts/main-layout/main-layout').then((m) => m.MainLayout),
    children: [
      {
        path: '',
        pathMatch: 'full',
        canActivate: [homeGuard],
        // Сюда не попадают: охранник всегда уводит на первый раздел в меню.
        loadComponent: () =>
          import('./features/documents/pages/documents/documents').then((m) => m.Documents),
      },
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
        path: 'products',
        title: 'Товары',
        loadComponent: () =>
          import('./features/purchases/pages/products/products').then((m) => m.Products),
      },
      {
        path: 'purchases',
        title: 'Планирование закупов',
        loadComponent: () =>
          import('./features/purchases/pages/purchases/purchases').then((m) => m.Purchases),
      },
      {
        path: 'purchases/:id',
        title: 'Планировка',
        loadComponent: () =>
          import('./features/purchases/pages/plan-details/plan-details').then((m) => m.PlanDetails),
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
  { path: '**', redirectTo: '' },
];
