'use client';

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useForm, Controller } from 'react-hook-form';
import Image from 'next/image';
import { BrandLogo } from '@/components/brand/BrandLogo';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/mq/button';
import { Input } from '@/components/ui/mq/input';
import { PasswordInput } from '@/components/ui/custom/PasswordInput';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/mq/alert';
import { APP_CONFIG, UNIVERSITY_CONFIG } from '@/lib/config';
import { API_ROUTES } from '@/lib/constants/config';
import { toastUtils } from '@/lib/utils/toast';
import { useTypedTranslation } from '@/lib/hooks/useTypedTranslation';
import { useProfilesStore } from '@/lib/store/profilesStore';
import { AlertTriangle, Check, Loader2, Mail } from 'lucide-react';
import { calculatePasswordStrength } from '@/lib/utils/security';
import { cn } from '@/lib/utils';
import { createAuthStepSchema, createSignupSchema } from '@/lib/schemas/auth';
import { createBrowserClient, isSupabaseConfigured } from '@/lib/supabase/client';
import { CourseCombobox } from './components/CourseCombobox';
import { FacultySelect } from './components/FacultySelect';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { getYearOptions } from '@/lib/data/mq-courses';

// react-hook-form expects the schema *input* shape, not the transformed output.
type SignupFormData = z.input<ReturnType<typeof createSignupSchema>>;

export default function SignupClient() {
  const { t } = useTypedTranslation();
  const router = useRouter();
  const addProfile = useProfilesStore((state) => state.addProfile);

  const signupSchema = useMemo(() => createSignupSchema(t), [t]);

  const [step, setStep] = useState<'auth' | 'profile' | 'confirmation'>('auth');
  const [serverError, setServerError] = useState<string | null>(null);
  const [oauthLoading, setOauthLoading] = useState(false);
  const [signupEmail, setSignupEmail] = useState<string>('');

  // Focus management
  const fullNameRef = useRef<HTMLInputElement>(null);

  // Faculty/course cascade guards — prevent reset on mount
  const prevFacultyRef = useRef<string>('');
  const prevCourseRef = useRef<string>('');

  // OAuth login handler
  const handleGoogleLogin = useCallback(async () => {
    if (!isSupabaseConfigured()) {
      toastUtils.error(t('oauthRequired'), t('googleOAuthDesc'));
      return;
    }

    if (typeof window === 'undefined') return;

    setServerError(null);
    setOauthLoading(true);

    try {
      const supabase = createBrowserClient();

      const callbackUrl = new URL('/auth/callback', window.location.origin);
      callbackUrl.searchParams.set('redirectTo', '/home');
      // Explicit marker so the callback can distinguish a real OAuth round-trip from
      // an email-verification link prefetch. See app/auth/callback/route.ts.
      callbackUrl.searchParams.set('flow', 'oauth');

      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: callbackUrl.toString(),
          skipBrowserRedirect: true,
        },
      });

      if (error) {
        toastUtils.error(t('loginErrorFailed'), error.message);
        setOauthLoading(false);
        return;
      }

      if (data?.url) {
        window.location.assign(data.url);
        return;
      }

      toastUtils.error(t('loginErrorFailed'), t('oauthSignInFailed'));
      setOauthLoading(false);
    } catch {
      toastUtils.error(t('loginErrorFailed'), t('unexpectedError'));
      setOauthLoading(false);
    }
  }, [t]);

  const {
    register,
    handleSubmit,
    watch,
    control,
    setValue,
    setError,
    clearErrors,
    getValues,
    formState: { errors, isSubmitting },
  } = useForm<SignupFormData>({
    resolver: zodResolver(signupSchema),
    mode: 'onBlur',
    defaultValues: {
      email: '',
      password: '',
      confirmPassword: '',
      agreedToTerms: false,
      fullName: '',
      studentId: '',
      faculty: '',
      course: '',
      year: '',
      _gotcha: '',
    } as unknown as SignupFormData,
  });

  // eslint-disable-next-line react-hooks/incompatible-library
  const password = watch('password');
  const passwordStrength = password ? calculatePasswordStrength(password) : null;

  const watchedFaculty = watch('faculty');
  const watchedCourse = watch('course');
  const yearOptions = watchedCourse ? getYearOptions(watchedCourse) : [];

  // Destructure fullName register ref so we can merge it with our own focus ref
  const { ref: registerFullNameRef, ...registerFullNameProps } = register('fullName');

  // Reset course+year when faculty changes (ref guard prevents reset on mount)
  useEffect(() => {
    if (prevFacultyRef.current !== watchedFaculty) {
      prevFacultyRef.current = watchedFaculty ?? '';
      setValue('course', '');
      setValue('year', '');
    }
  }, [watchedFaculty, setValue]);

  // Reset year when course changes (ref guard prevents reset on mount)
  useEffect(() => {
    if (prevCourseRef.current !== watchedCourse) {
      prevCourseRef.current = watchedCourse ?? '';
      setValue('year', '');
    }
  }, [watchedCourse, setValue]);

  const handleNextStep = useCallback(() => {
    // Validate step 1 *independently* of the full signup schema. Using
    // `trigger([...])` here was racy at mount: RHF's resolver swaps when the
    // translation callback reference changes during i18n hydration, and
    // the top-level `.refine()` forces step-2 fields into the same pass.
    // A direct `safeParse(getValues())` is synchronous and deterministic.
    const authStepFields = [
      'email',
      'password',
      'confirmPassword',
      'agreedToTerms',
      '_gotcha',
    ] as const;

    authStepFields.forEach((f) => clearErrors(f));

    const authStepSchema = createAuthStepSchema(t);
    const result = authStepSchema.safeParse(getValues());

    if (!result.success) {
      // Surface every issue on its own field so the form renders inline errors.
      for (const issue of result.error.issues) {
        const field = issue.path[0];
        if (typeof field === 'string' && (authStepFields as readonly string[]).includes(field)) {
          setError(field as (typeof authStepFields)[number], {
            type: 'manual',
            message: issue.message,
          });
        }
      }
      return;
    }

    setServerError(null);
    setStep('profile');
    setTimeout(() => fullNameRef.current?.focus(), 100);
  }, [t, clearErrors, getValues, setError]);

  const onSubmit = async (data: SignupFormData) => {
    setServerError(null);

    try {
      const response = await fetch(API_ROUTES.AUTH.SIGNUP, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: data.email,
          password: data.password,
          confirmPassword: data.confirmPassword,
          agreedToTerms: data.agreedToTerms,
          _gotcha: data._gotcha,
          fullName: data.fullName,
          studentId: data.studentId,
          faculty: data.faculty,
          course: data.course,
          year: data.year,
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        const errorMessage =
          typeof result.error === 'string'
            ? result.error
            : result.error?.message || t('unexpectedError');

        // If the API flagged a specific field (e.g. email for "account exists"),
        // jump back to step 1 and pin the error on that field inline.
        // jsonError() nests details under error.details.
        const target = (typeof result.error === 'object' && result.error?.details?.target) || null;

        if (target === 'email') {
          // Jump back to step 1 and show the error in THREE places so the user
          // can't miss it: top-level banner (serverError), inline field error,
          // and a toast. The previous behavior cleared serverError, which made
          // the bounce-back look silent when triggered from step 2.
          setStep('auth');
          setError('email', { type: 'server', message: errorMessage });
          setServerError(errorMessage);
          toastUtils.error(t('signupFailed'), errorMessage);
          return;
        }

        setServerError(errorMessage);
        return;
      }

      addProfile({
        name: data.fullName,
        email: data.email,
        studentId: data.studentId,
        faculty: data.faculty || '',
        course: data.course || '',
        year: data.year || '',
        preferences: {
          notifications: true,
          emailReminders: true,
          pushNotifications: false,
        },
      });

      if (result.data?.session) {
        toastUtils.success(t('accountCreated'), t('signedInNow'));
        router.push('/home');
      } else {
        setSignupEmail(data.email);
        setStep('confirmation');
      }
    } catch {
      setServerError(t('unexpectedError'));
    }
  };

  return (
    <div className="signup-page relative min-h-[100dvh] bg-mq-background">
      {/* Fixed background image */}
      <div className="fixed inset-0 overflow-hidden">
        <Image
          src="/images/login-bg.png"
          alt=""
          fill
          className="object-cover"
          priority
          sizes="100vw"
          quality={60}
        />
        <div className="absolute inset-0 bg-gradient-to-b from-mq-navy-900/88 via-mq-background/80 to-mq-background/95" />
      </div>

      {/* Scrollable content */}
      <div className="relative z-10 flex min-h-[100dvh] items-start sm:items-center justify-center px-4 py-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
        <div className="w-full max-w-md">
          <div className="bg-mq-card-background/85 backdrop-blur-xl border border-mq-border/30 rounded-2xl shadow-[0_18px_70px_rgba(0,0,0,0.3)] overflow-hidden">
            {/* Card Header */}
            <div className="px-6 pt-8 pb-4 space-y-3">
              <div className="flex items-center justify-center">
                {step === 'confirmation' ? (
                  <div className="w-14 h-14 rounded-full bg-mq-success flex items-center justify-center shadow-lg">
                    <Mail className="w-7 h-7 text-white" />
                  </div>
                ) : (
                  <BrandLogo
                  alt={APP_CONFIG.name}
                  height={96}
                  priority
                  tile
                  tileClassName="rounded-2xl p-3 shadow-lg"
                  variant="icon"
                />
                )}
              </div>

              <div className="text-center space-y-1">
                <h1 className="text-2xl font-bold text-mq-content">
                  {step === 'confirmation'
                    ? t('accountCreated')
                    : step === 'auth'
                      ? t('joinApp', { appName: APP_CONFIG.name })
                      : t('completeProfile')}
                </h1>
                <p className="text-sm text-mq-content-secondary">
                  {step === 'confirmation'
                    ? t('verifyEmail')
                    : step === 'auth'
                      ? t('createAccountFor', {
                          uniName: UNIVERSITY_CONFIG.name,
                        })
                      : t('fillProfileDetails')}
                </p>
              </div>

              {/* Step indicator */}
              {step !== 'confirmation' && (
                <div className="flex items-center justify-center gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => step === 'profile' && setStep('auth')}
                    className={cn(
                      'flex items-center gap-1 px-3 py-1.5 rounded-full transition-colors text-xs font-semibold',
                      step === 'auth'
                        ? 'bg-mq-primary/15 text-mq-primary border border-mq-primary/20'
                        : 'bg-mq-success/15 text-mq-success cursor-pointer hover:bg-mq-success/25 border border-mq-success/20',
                    )}
                    disabled={step === 'auth' || isSubmitting}
                  >
                    {step === 'profile' ? (
                      <Check className="w-3 h-3" />
                    ) : (
                      <div className="w-2 h-2 rounded-full bg-mq-primary" />
                    )}
                    {t('stepAccount')}
                  </button>
                  <div
                    className={cn(
                      'w-8 h-0.5 rounded-full',
                      step === 'profile' ? 'bg-mq-primary' : 'bg-mq-border',
                    )}
                  />
                  <div
                    className={cn(
                      'flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-semibold border',
                      step === 'profile'
                        ? 'bg-mq-primary/15 text-mq-primary border-mq-primary/20'
                        : 'bg-mq-border/30 text-mq-content-secondary border-mq-border/20',
                    )}
                  >
                    <div
                      className={cn(
                        'w-2 h-2 rounded-full',
                        step === 'profile' ? 'bg-mq-primary' : 'bg-mq-border',
                      )}
                    />
                    {t('stepProfile')}
                  </div>
                </div>
              )}
            </div>

            {/* Card Content */}
            <div className="px-6 pb-8 space-y-4">
              {serverError && (
                <Alert variant="error">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription>{serverError}</AlertDescription>
                </Alert>
              )}

              <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
                {/* Honeypot field */}
                <input
                  {...register('_gotcha')}
                  className="hidden"
                  tabIndex={-1}
                  autoComplete="off"
                  aria-hidden="true"
                />

                {/* ── Step 1: Authentication ── */}
                <div className={cn('space-y-4', step !== 'auth' && 'hidden')}>
                  <div className="space-y-2">
                    <Label htmlFor="email" className="font-bold text-mq-content">
                      {t('email')} <span className="text-mq-error">*</span>
                    </Label>
                    <Input
                      id="email"
                      type="email"
                      placeholder={t('emailPlaceholder')}
                      disabled={isSubmitting}
                      className="h-12 rounded-xl"
                      {...register('email')}
                      aria-invalid={!!errors.email}
                      aria-describedby={errors.email ? 'email-error' : undefined}
                    />
                    {errors.email && (
                      <p id="email-error" className="text-xs text-mq-error">
                        {errors.email.message}
                      </p>
                    )}
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="password" className="font-bold text-mq-content">
                      {t('password')} <span className="text-mq-error">*</span>
                    </Label>
                    <PasswordInput
                      id="password"
                      disabled={isSubmitting}
                      maxLength={64}
                      className="h-12 rounded-xl"
                      {...register('password')}
                      aria-invalid={!!errors.password}
                      aria-describedby={errors.password ? 'password-error' : undefined}
                    />
                    {errors.password && (
                      <p id="password-error" className="text-xs text-mq-error">
                        {errors.password.message}
                      </p>
                    )}

                    {/* Visual Password Feedback */}
                    {passwordStrength && !errors.password && (
                      <div className="space-y-1 mt-2">
                        <div className="flex gap-1 h-1">
                          {[0, 1, 2, 3, 4].map((idx) => (
                            <div
                              key={idx}
                              className={cn(
                                'flex-1 rounded-full transition-colors',
                                idx <= passwordStrength.score
                                  ? passwordStrength.color
                                  : 'bg-mq-border',
                              )}
                            />
                          ))}
                        </div>
                        <div className="flex justify-between items-center">
                          <p
                            className={cn(
                              'text-xs font-medium',
                              passwordStrength.score < 2 ? 'text-mq-error' : 'text-mq-success',
                            )}
                          >
                            {passwordStrength.label}
                          </p>
                          {passwordStrength.feedback?.[0] && (
                            <p className="text-xs text-mq-content-secondary">
                              {passwordStrength.feedback[0]}
                            </p>
                          )}
                        </div>
                      </div>
                    )}
                    <p className="text-xs text-mq-content-secondary mt-1">
                      {t('passwordMinLength')}
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="confirmPassword" className="font-bold text-mq-content">
                      {t('confirmPassword')} <span className="text-mq-error">*</span>
                    </Label>
                    <PasswordInput
                      id="confirmPassword"
                      disabled={isSubmitting}
                      maxLength={64}
                      className="h-12 rounded-xl"
                      {...register('confirmPassword')}
                      aria-invalid={!!errors.confirmPassword}
                      aria-describedby={errors.confirmPassword ? 'confirmPassword-error' : undefined}
                    />
                    {errors.confirmPassword && (
                      <p id="confirmPassword-error" className="text-xs text-mq-error">
                        {errors.confirmPassword.message}
                      </p>
                    )}
                  </div>

                  <div className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      id="terms"
                      className="mt-1 h-4 w-4 rounded border-mq-border text-mq-primary focus:ring-mq-primary"
                      disabled={isSubmitting}
                      {...register('agreedToTerms')}
                      aria-invalid={!!errors.agreedToTerms}
                      aria-describedby={errors.agreedToTerms ? 'agreedToTerms-error' : undefined}
                    />
                    <label htmlFor="terms" className="text-sm text-mq-content-secondary">
                      <span className="text-mq-error">*</span> {t('agreeToTerms')}{' '}
                      <Link href="/terms" className="text-mq-primary hover:underline font-medium">
                        {t('termsOfService')}
                      </Link>{' '}
                      {t('and')}{' '}
                      <Link href="/privacy" className="text-mq-primary hover:underline font-medium">
                        {t('privacyPolicy')}
                      </Link>
                    </label>
                  </div>
                  {errors.agreedToTerms && (
                    <p id="agreedToTerms-error" className="text-xs text-mq-error">
                      {errors.agreedToTerms.message}
                    </p>
                  )}

                  {/* APP 5 Collection Notice */}
                  <p className="text-xs text-mq-content-secondary leading-relaxed">
                    {t('collectionNotice')}{' '}
                    <Link href="/privacy" className="text-mq-primary hover:underline font-medium">
                      {t('privacyPolicy')}
                    </Link>
                  </p>

                  <Button
                    type="button"
                    onClick={handleNextStep}
                    className="w-full h-12 rounded-xl font-bold"
                    disabled={isSubmitting || oauthLoading}
                  >
                    {t('next')}
                  </Button>

                  {/* OAuth divider */}
                  <div className="flex items-center gap-3 text-xs text-mq-content font-semibold">
                    <div className="h-px flex-1 bg-mq-border" />
                    <span>{t('orSignWith')}</span>
                    <div className="h-px flex-1 bg-mq-border" />
                  </div>

                  <Button
                    type="button"
                    variant="outline"
                    className="h-12 w-full rounded-full flex items-center justify-center gap-2 font-bold"
                    onClick={handleGoogleLogin}
                    disabled={isSubmitting || oauthLoading}
                  >
                    {oauthLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <svg
                        className="h-4 w-4"
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 533.5 544.3"
                        aria-hidden="true"
                      >
                        <path
                          fill="#4285F4"
                          d="M533.5 278.4c0-17.4-1.5-34.1-4.3-50.4H272.1v95.4h146.9c-6.3 34-25 62.8-53.4 82.1v68.2h86.5c50.7-46.7 81.4-115.5 81.4-195.3z"
                        />
                        <path
                          fill="#34A853"
                          d="M272.1 544.3c72.4 0 133.1-23.9 177.5-64.9l-86.5-68.2c-24.1 16.2-55 25.7-90.9 25.7-69.9 0-129.3-47.2-150.5-110.7H34.1v69.6c44.5 88.3 136.1 148.5 238 148.5z"
                        />
                        <path
                          fill="#FBBC05"
                          d="M121.6 325.9c-10-29.6-10-61.5 0-91.1v-69.6H34.1c-44.5 88.3-44.5 192.1 0 280.4l87.5-69.7z"
                        />
                        <path
                          fill="#EA4335"
                          d="M272.1 107.7c37.1-.6 72.6 12.8 99.8 37.8l74.5-74.5C405.1 24 345.4 0 272.1 0 170.2 0 78.6 60.2 34.1 148.5l87.5 69.7c21.1-63.5 80.6-110.7 150.5-110.7z"
                        />
                      </svg>
                    )}
                    <span>{t('loginWithGoogle')}</span>
                  </Button>
                </div>

                {/* ── Step 2: Profile ── */}
                <div className={cn('space-y-4', step !== 'profile' && 'hidden')}>
                  <div className="space-y-2">
                    <Label htmlFor="fullName" className="font-bold text-mq-content">
                      {t('fullName')} <span className="text-mq-error">*</span>
                    </Label>
                    <Input
                      id="fullName"
                      placeholder={t('enterFullName')}
                      disabled={isSubmitting}
                      className="h-12 rounded-xl"
                      {...registerFullNameProps}
                      ref={(e) => {
                        registerFullNameRef(e);
                        fullNameRef.current = e;
                      }}
                      aria-invalid={!!errors.fullName}
                      aria-describedby={errors.fullName ? 'fullName-error' : undefined}
                    />
                    {errors.fullName && (
                      <p id="fullName-error" className="text-xs text-mq-error">
                        {errors.fullName.message}
                      </p>
                    )}
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="studentId" className="font-bold text-mq-content">
                      {t('studentId')} <span className="text-mq-error">*</span>
                    </Label>
                    <Input
                      id="studentId"
                      placeholder={t('studentIdPlaceholder')}
                      disabled={isSubmitting}
                      className="h-12 rounded-xl"
                      {...register('studentId')}
                      aria-invalid={!!errors.studentId}
                      aria-describedby={errors.studentId ? 'studentId-error' : undefined}
                    />
                    {errors.studentId && (
                      <p id="studentId-error" className="text-xs text-mq-error">
                        {errors.studentId.message}
                      </p>
                    )}
                  </div>

                  {/* Faculty */}
                  <div className="space-y-2">
                    <Label htmlFor="faculty" className="font-bold text-mq-content">
                      {t('faculty')} <span className="text-mq-error">*</span>
                    </Label>
                    <Controller
                      name="faculty"
                      control={control}
                      render={({ field }) => (
                        <FacultySelect
                          value={field.value ?? ''}
                          onChange={field.onChange}
                          placeholder={t('selectFaculty')}
                          error={!!errors.faculty}
                        />
                      )}
                    />
                    {errors.faculty && (
                      <p id="faculty-error" className="text-xs text-mq-error">
                        {errors.faculty.message}
                      </p>
                    )}
                  </div>

                  {/* Course — searchable combobox */}
                  <div className="space-y-2">
                    <Label htmlFor="course" className="font-bold text-mq-content">
                      {t('course')} <span className="text-mq-error">*</span>
                    </Label>
                    <Controller
                      name="course"
                      control={control}
                      render={({ field }) => (
                        <CourseCombobox
                          value={field.value ?? ''}
                          onChange={field.onChange}
                          disabled={isSubmitting || !watchedFaculty}
                          error={!!errors.course}
                          facultyFilter={watchedFaculty}
                        />
                      )}
                    />
                    {errors.course && (
                      <p id="course-error" className="text-xs text-mq-error">
                        {errors.course.message}
                      </p>
                    )}
                  </div>

                  {/* Year of Study */}
                  <div className="space-y-2">
                    <Label htmlFor="year" className="font-bold text-mq-content">
                      {t('year')} <span className="text-mq-error">*</span>
                    </Label>
                    <Controller
                      name="year"
                      control={control}
                      render={({ field }) => (
                        <Select
                          value={field.value ?? ''}
                          onValueChange={field.onChange}
                          disabled={isSubmitting || !watchedCourse}
                        >
                          <SelectTrigger
                            className={cn(
                              'w-full h-12 rounded-xl border-mq-border focus:ring-[3px] focus:border-mq-focus focus:ring-mq-focus/40 bg-mq-input-background',
                              errors.year && 'border-mq-error',
                            )}
                            aria-invalid={!!errors.year}
                            aria-describedby={errors.year ? 'year-error' : undefined}
                          >
                            <SelectValue
                              placeholder={
                                watchedCourse ? t('yearPlaceholder') : t('selectCourseFirst')
                              }
                            />
                          </SelectTrigger>
                          <SelectContent className="bg-mq-card-background border-mq-border overflow-hidden">
                            {yearOptions.map((y) => (
                              <SelectItem
                                key={y}
                                value={String(y)}
                                className="cursor-pointer hover:bg-mq-hover-background focus:bg-mq-hover-background focus:text-mq-primary"
                              >
                                {t('yearNumber', { year: y })}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    />
                    {errors.year && (
                      <p id="year-error" className="text-xs text-mq-error">
                        {errors.year.message}
                      </p>
                    )}
                  </div>

                  <div className="flex gap-2 pt-2">
                    <Button
                      type="button"
                      variant="outline"
                      className="flex-1 h-12 rounded-xl font-bold"
                      onClick={() => setStep('auth')}
                      disabled={isSubmitting}
                    >
                      {t('back')}
                    </Button>
                    <Button
                      type="submit"
                      className="flex-1 h-12 rounded-xl font-bold"
                      disabled={isSubmitting}
                    >
                      {isSubmitting ? <Loader2 className="animate-spin w-4 h-4 mr-2" /> : null}
                      {isSubmitting ? t('creatingAccount') : t('createAccount')}
                    </Button>
                  </div>
                </div>
              </form>

              {/* ── Email Confirmation Screen ── */}
              {step === 'confirmation' && (
                <div className="space-y-4 text-center">
                  <div className="bg-mq-success/10 border border-mq-success/20 rounded-xl p-4">
                    <p className="text-sm text-mq-content leading-relaxed">
                      {t('signupConfirmationSent', { email: signupEmail })}
                    </p>
                  </div>
                  <div className="space-y-2 text-sm text-mq-content-secondary">
                    <p>{t('signupConfirmationHint')}</p>
                  </div>
                  <Button
                    type="button"
                    onClick={() => router.push('/login')}
                    className="w-full h-12 rounded-xl font-bold"
                  >
                    {t('goToLogin')}
                  </Button>
                </div>
              )}

              {step !== 'confirmation' && (
                <div className="text-center text-sm text-mq-content-secondary">
                  <p>
                    {t('alreadyHaveAccount')}{' '}
                    <button
                      type="button"
                      onClick={() => router.push('/login')}
                      className="text-mq-primary hover:underline font-bold"
                      disabled={isSubmitting || oauthLoading}
                    >
                      {t('signIn')}
                    </button>
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
