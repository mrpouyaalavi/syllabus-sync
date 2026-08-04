'use client';

import { useState, useEffect } from 'react';
import { useForm, Controller, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useRouter, useSearchParams } from 'next/navigation';
import Image from 'next/image';
import { BrandLogo } from '@/components/brand/BrandLogo';
import { CourseCombobox } from '@/app/signup/components/CourseCombobox';
import { FacultySelect } from '@/app/signup/components/FacultySelect';
import { getYearOptions } from '@/lib/data/mq-courses';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/mq/button';
import { Label } from '@/components/ui/label';
import { isValidRedirect } from '@/lib/utils/security';
import { APP_CONFIG } from '@/lib/config';
import { ArrowRight, Loader2 } from 'lucide-react';
import { useTypedTranslation } from '@/lib/hooks/useTypedTranslation';
import { TranslationKey } from '@/lib/i18n/translations';

const createSchema = (
  t: (key: TranslationKey, options?: Record<string, string | number>) => string,
) =>
  z.object({
    faculty: z.string().min(1, t('pleaseSelectFaculty' as TranslationKey)),
    course: z.string().min(1, t('pleaseSelectCourse' as TranslationKey)),
    year: z.string().min(1, t('pleaseSelectYear' as TranslationKey)),
  });
type FormData = z.infer<ReturnType<typeof createSchema>>;

export default function OnboardingClient() {
  const { t } = useTypedTranslation();
  const schema = createSchema(t);
  const router = useRouter();
  const searchParams = useSearchParams();
  const rawNext = searchParams.get('next') ?? '/home';
  const next = isValidRedirect(rawNext) ? rawNext : '/home';

  const [serverError, setServerError] = useState('');

  const {
    control,
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { faculty: '', course: '', year: '' },
  });

  const selectedFaculty = useWatch({ control, name: 'faculty' });
  const selectedCourse = useWatch({ control, name: 'course' });

  // Reset course and year when faculty changes
  useEffect(() => {
    setValue('course', '');
    setValue('year', '');
  }, [selectedFaculty, setValue]);

  // Reset year when course changes
  useEffect(() => {
    setValue('year', '');
  }, [selectedCourse, setValue]);

  const yearOptions = selectedCourse ? getYearOptions(selectedCourse) : [];

  const onSubmit = async (data: FormData) => {
    setServerError('');
    try {
      const res = await fetch('/api/auth/onboarding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error?.message || t('failedToSave'));
      }
      // New OAuth users reach /home for the first time via this path — mark the
      // first-login prompt flag so the permission dialogs fire after redirect.
      const { markFirstLoginPromptsPending } = await import(
        '@/features/home/hooks/useFirstLoginPrompts'
      );
      markFirstLoginPromptsPending();
      router.push(next);
    } catch (err) {
      setServerError(err instanceof Error ? err.message : t('unexpectedError'));
    }
  };

  return (
    <div className="relative min-h-[100dvh] bg-mq-background">
      {/* Background image — same as login/signup */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <Image
          src="/images/login-bg.png"
          alt=""
          fill
          className="object-cover"
          priority
          sizes="100vw"
          quality={60}
        />
        <div className="absolute inset-0 bg-gradient-to-b from-[#001528]/88 via-mq-background/80 to-mq-background/95" />
      </div>

      {/* Content */}
      <div className="relative z-10 flex min-h-[100dvh] items-center justify-center px-4 py-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
        <div className="w-full max-w-md">
          {/* Glass card */}
          <div className="bg-mq-card-background/85 backdrop-blur-xl border border-mq-border/30 rounded-2xl shadow-[0_18px_70px_rgba(0,0,0,0.3)] overflow-hidden">
            {/* Header */}
            <div className="px-6 pt-8 pb-6 text-center">
              <div className="flex items-center justify-center mb-4">
                <BrandLogo
                  alt={APP_CONFIG.name}
                  height={88}
                  priority
                  tile
                  tileClassName="rounded-2xl p-3 shadow-lg"
                  variant="icon"
                />
              </div>
              <h1 className="text-2xl font-bold text-mq-content mb-2">{t('onboardingTitle')}</h1>
              <p className="text-sm text-mq-content-secondary">{t('onboardingDesc')}</p>
            </div>

            {/* Form */}
            <form onSubmit={handleSubmit(onSubmit)} className="px-6 pb-8 space-y-5">
              {/* Faculty */}
              <div className="space-y-2">
                <Label className="text-sm font-medium text-mq-content">{t('faculty')}</Label>
                <Controller
                  name="faculty"
                  control={control}
                  render={({ field }) => (
                    <FacultySelect
                      value={field.value}
                      onChange={field.onChange}
                      placeholder={t('selectFaculty')}
                    />
                  )}
                />
                {errors.faculty && <p className="text-xs text-red-500">{errors.faculty.message}</p>}
              </div>

              {/* Course */}
              <div className="space-y-2">
                <Label className="text-sm font-medium text-mq-content">{t('course')}</Label>
                <Controller
                  name="course"
                  control={control}
                  render={({ field }) => (
                    <CourseCombobox
                      value={field.value}
                      onChange={field.onChange}
                      disabled={!selectedFaculty}
                      error={!!errors.course}
                      facultyFilter={selectedFaculty}
                    />
                  )}
                />
                {errors.course && <p className="text-xs text-red-500">{errors.course.message}</p>}
              </div>

              {/* Year */}
              <div className="space-y-2">
                <Label className="text-sm font-medium text-mq-content">{t('yearOfStudy')}</Label>
                <Controller
                  name="year"
                  control={control}
                  render={({ field }) => (
                    <Select
                      value={field.value}
                      onValueChange={field.onChange}
                      disabled={!selectedCourse}
                    >
                      <SelectTrigger
                        className={`h-12 rounded-xl ${errors.year ? 'border-red-500' : ''}`}
                      >
                        <SelectValue
                          placeholder={
                            selectedCourse ? t('yearPlaceholder') : t('selectCourseFirst')
                          }
                        />
                      </SelectTrigger>
                      <SelectContent>
                        {yearOptions.map((y) => (
                          <SelectItem key={y} value={String(y)}>
                            {t('yearNumber', { year: y })}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
                {errors.year && <p className="text-xs text-red-500">{errors.year.message}</p>}
              </div>

              {serverError && <p className="text-sm text-red-500 text-center">{serverError}</p>}

              <Button
                type="submit"
                disabled={isSubmitting}
                className="w-full h-12 rounded-xl font-bold text-base mt-2 flex items-center justify-center gap-2"
              >
                {isSubmitting ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <>
                    {t('continue')}
                    <ArrowRight className="h-5 w-5" />
                  </>
                )}
              </Button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
