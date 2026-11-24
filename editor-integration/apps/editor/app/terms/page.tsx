import { I18nText } from '@pascal-app/editor/i18n'
import type { Metadata } from 'next'
import Link from 'next/link'
import { LanguageSelector } from '@/components/language-selector'

export const metadata: Metadata = {
  title: 'Terms of Service',
  description: 'Terms of Service for Pascal Editor and the Pascal platform.',
}

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 border-border border-b bg-background/95 backdrop-blur">
        <div className="container mx-auto px-6 py-4">
          <nav className="flex items-center gap-4 text-sm">
            <Link
              className="text-muted-foreground transition-colors hover:text-foreground"
              href="/"
            >
              <I18nText message={'Home'} />
            </Link>
            <span className="text-muted-foreground">/</span>
            <span className="font-medium text-foreground">
              <I18nText message={'Terms of Service'} />
            </span>
            <span className="text-muted-foreground">|</span>
            <Link
              className="text-muted-foreground transition-colors hover:text-foreground"
              href="/privacy"
            >
              <I18nText message={'Privacy Policy'} />
            </Link>
            <LanguageSelector />
          </nav>
        </div>
      </header>

      <main className="container mx-auto max-w-3xl px-6 py-12">
        <article className="prose prose-neutral dark:prose-invert max-w-none">
          <h1 className="mb-2 font-bold text-3xl">
            <I18nText message={'Terms of Service'} />
          </h1>
          <p className="mb-8 text-muted-foreground text-sm">
            <I18nText message={'Effective Date: February 20, 2026'} />
          </p>

          <section className="mb-8 space-y-4">
            <h2 className="font-semibold text-xl">
              <I18nText message={'1. Introduction'} />
            </h2>
            <p className="text-foreground/90 leading-relaxed">
              <I18nText
                message={
                  'Welcome to Pascal Editor ("Editor") and the Pascal platform at pascal.app ("Platform"), operated by Pascal Group Inc. ("we," "us," or "our"). By accessing or using our services, you agree to these Terms of Service.'
                }
              />
            </p>
          </section>

          <section className="mb-8 space-y-4">
            <h2 className="font-semibold text-xl">
              <I18nText message={'2. The Editor and Platform'} />
            </h2>
            <p className="text-foreground/90 leading-relaxed">
              <I18nText
                message={
                  'The Pascal Editor is open-source software released under the MIT License. You may use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Editor software in accordance with the MIT License terms.'
                }
              />
            </p>
            <p className="text-foreground/90 leading-relaxed">
              <I18nText
                message={
                  'The Pascal platform (pascal.app) and its associated services, including user accounts, cloud storage, and project hosting, are proprietary services owned and operated by Pascal Group Inc. These Terms govern your use of the Platform.'
                }
              />
            </p>
          </section>

          <section className="mb-8 space-y-4">
            <h2 className="font-semibold text-xl">
              <I18nText message={'3. Accounts and Authentication'} />
            </h2>
            <p className="text-foreground/90 leading-relaxed">
              <I18nText
                message={
                  'To use certain features of the Platform, you must create an account. We use Google OAuth and magic link email authentication through Supabase. You are responsible for maintaining the security of your account credentials and for all activities that occur under your account.'
                }
              />
            </p>
          </section>

          <section className="mb-8 space-y-4">
            <h2 className="font-semibold text-xl">
              <I18nText message={'4. Acceptable Use'} />
            </h2>
            <p className="text-foreground/90 leading-relaxed">
              <I18nText message={'You agree not to:'} />
            </p>
            <ul className="list-disc space-y-2 pl-6 text-foreground/90">
              <li>
                <I18nText
                  message={
                    'Use the Platform for any unlawful purpose or in violation of any applicable laws'
                  }
                />
              </li>
              <li>
                <I18nText
                  message={
                    'Upload, share, or distribute content that infringes intellectual property rights'
                  }
                />
              </li>
              <li>
                <I18nText
                  message={'Attempt to gain unauthorized access to the Platform or its systems'}
                />
              </li>
              <li>
                <I18nText message={"Interfere with or disrupt the Platform's infrastructure"} />
              </li>
              <li>
                <I18nText message={'Upload malicious code, viruses, or harmful content'} />
              </li>
              <li>
                <I18nText message={'Harass, abuse, or harm other users'} />
              </li>
              <li>
                <I18nText message={'Use the Platform to send spam or unsolicited communications'} />
              </li>
            </ul>
          </section>

          <section className="mb-8 space-y-4">
            <h2 className="font-semibold text-xl">
              <I18nText message={'5. Your Content and Intellectual Property'} />
            </h2>
            <p className="text-foreground/90 leading-relaxed">
              <I18nText
                message={
                  'You retain full ownership of all content, projects, and data you create or upload to the Platform ("Your Content"). By using the Platform, you grant us a limited license to store, display, and transmit Your Content solely to provide our services to you.'
                }
              />
            </p>
            <p className="text-foreground/90 leading-relaxed">
              <I18nText
                message={
                  'We do not claim any ownership rights over Your Content. You may export or delete Your Content at any time.'
                }
              />
            </p>
          </section>

          <section className="mb-8 space-y-4">
            <h2 className="font-semibold text-xl">
              <I18nText message={'6. Platform Ownership'} />
            </h2>
            <p className="text-foreground/90 leading-relaxed">
              <I18nText
                message={
                  'The Platform, including its design, features, and proprietary code, is owned by Pascal Group Inc. and protected by intellectual property laws. While the Editor source code is open-source under the MIT License, the Platform services, branding, and infrastructure remain our proprietary property.'
                }
              />
            </p>
          </section>

          <section className="mb-8 space-y-4">
            <h2 className="font-semibold text-xl">
              <I18nText message={'7. Account Termination'} />
            </h2>
            <p className="text-foreground/90 leading-relaxed">
              <I18nText
                message={
                  'We reserve the right to suspend or terminate your account if you violate these Terms or engage in conduct that we determine is harmful to the Platform or other users. You may also delete your account at any time by contacting us at'
                }
              />{' '}
              <a
                className="text-foreground underline hover:text-foreground/80"
                href="mailto:support@pascal.app"
              >
                support@pascal.app
              </a>
              .
            </p>
          </section>

          <section className="mb-8 space-y-4">
            <h2 className="font-semibold text-xl">
              <I18nText message={'8. Disclaimer of Warranties'} />
            </h2>
            <p className="text-foreground/90 leading-relaxed">
              <I18nText
                message={
                  'THE PLATFORM IS PROVIDED "AS IS" AND "AS AVAILABLE" WITHOUT WARRANTIES OF ANY KIND, EITHER EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO IMPLIED WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND NON-INFRINGEMENT.'
                }
              />
            </p>
            <p className="text-foreground/90 leading-relaxed">
              <I18nText
                message={
                  'We do not warrant that the Platform will be uninterrupted, error-free, or free of harmful components.'
                }
              />
            </p>
          </section>

          <section className="mb-8 space-y-4">
            <h2 className="font-semibold text-xl">
              <I18nText message={'9. Limitation of Liability'} />
            </h2>
            <p className="text-foreground/90 leading-relaxed">
              <I18nText
                message={
                  'TO THE MAXIMUM EXTENT PERMITTED BY LAW, PASCAL GROUP INC. SHALL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, INCLUDING LOSS OF DATA, PROFITS, OR GOODWILL, ARISING FROM YOUR USE OF THE PLATFORM.'
                }
              />
            </p>
          </section>

          <section className="mb-8 space-y-4">
            <h2 className="font-semibold text-xl">
              <I18nText message={'10. Changes to Terms'} />
            </h2>
            <p className="text-foreground/90 leading-relaxed">
              <I18nText
                message={
                  'We may update these Terms from time to time. We will notify you of material changes by posting the updated Terms on the Platform. Your continued use of the Platform after changes are posted constitutes your acceptance of the revised Terms.'
                }
              />
            </p>
          </section>

          <section className="space-y-4">
            <h2 className="font-semibold text-xl">
              <I18nText message={'11. Contact Us'} />
            </h2>
            <p className="text-foreground/90 leading-relaxed">
              <I18nText message={'If you have questions about these Terms, please contact us at'} />{' '}
              <a
                className="text-foreground underline hover:text-foreground/80"
                href="mailto:support@pascal.app"
              >
                support@pascal.app
              </a>
              .
            </p>
          </section>
        </article>
      </main>
    </div>
  )
}
