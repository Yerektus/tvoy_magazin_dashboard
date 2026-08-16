import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';

import { Button } from '../../../../shared/components/button/button';
import { TextField } from '../../../../shared/components/text-field/text-field';
import { Toasts } from '../../../../shared/services/toasts';
import { Auth } from '../../services/auth';

@Component({
  selector: 'app-login',
  imports: [ReactiveFormsModule, TextField, Button],
  templateUrl: './login.html',
})
export class Login {
  protected readonly form = inject(FormBuilder).nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', Validators.required],
  });

  protected readonly submitting = signal(false);

  private readonly auth = inject(Auth);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly toasts = inject(Toasts);

  protected async submit(): Promise<void> {
    if (this.form.invalid || this.submitting()) {
      this.form.markAllAsTouched();
      return;
    }

    this.submitting.set(true);

    const { email, password } = this.form.getRawValue();

    try {
      await this.auth.login(email, password);
      this.toasts.success('Вы вошли');
      await this.router.navigateByUrl(this.returnUrl());
    } catch (error) {
      this.toasts.error(error instanceof Error ? error.message : 'Не удалось войти');
    } finally {
      this.submitting.set(false);
    }
  }

  /** Куда вернуть после входа. Чужие адреса игнорируем. */
  private returnUrl(): string {
    const target = this.route.snapshot.queryParamMap.get('returnUrl');
    return target?.startsWith('/') && !target.startsWith('//') ? target : '/documents';
  }
}
