/**
 * Buttons — and the reason a disabled one is disabled.
 *
 * DEC-26 says a control that cannot work is never offered as a dead button.
 * Where a control genuinely has to stay on screen and stay unavailable, the
 * reason goes *beside* it, in French, in the DOM. Not in a `title` attribute
 * (which no touch, no keyboard and no screen-reader user reaches), not in a
 * tooltip, not only in a comment.
 *
 * That is enforced by the type, not by review: `disabled: true` is only
 * constructible together with `disabledReason`, and a blank reason throws. The
 * cost is real and deliberate — `disabled={busy}` no longer compiles, and the
 * author has to decide what "Envoi en cours…" should say. That decision is the
 * feature.
 *
 * On colour: `--accent` is not a button fill here. VISION.md §6 gives orange
 * exactly one meaning — armed or recording — and explicitly excludes primary
 * buttons. It is also 2.44:1 against white, so the white-on-orange *Valider* and
 * *Démarrer* that the screens carry today are unreadable to anyone who needs
 * contrast. `primary` is `--brand-700` (6.28:1 with white on it), which is the
 * step of the ramp VISION.md §6 nominates for exactly this.
 */
import { cva, type VariantProps } from 'class-variance-authority'
import { useId, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { cn } from '../lib/utils.ts'

const button = cva('shrink-0 transition disabled:cursor-not-allowed disabled:opacity-50', {
  variants: {
    variant: {
      /** The default control: a bordered chip of a button on a card. */
      bordered:
        'border-card bg-inner text-strong hover:bg-subtle rounded-sm border px-3 py-1.5 text-ui font-medium',
      /** One per view at most. Brand blue marks action and navigation. */
      primary: 'bg-brand-700 text-inner rounded-sm px-3 py-1.5 text-ui font-medium',
      /**
       * The way back out of a screen — *‹ Calendrier*, and only that.
       *
       * VISION.md §6: « Brand blue marks selection and navigation ». The back
       * links were `text`, which is `--text-muted`, the same grey as every
       * caption and every unavailable reason on the page. The one control that
       * moves a rep between screens should not be the quietest thing on it.
       * `--brand-700` is 6.28:1 on white and the step the ramp nominates for
       * links.
       */
      nav: 'text-brand-700 hover:text-brand-900 text-ui',
      /** Header links, *Réessayer*, pane toggles. Density over decoration. */
      text: 'text-muted hover:text-body text-ui',
      /** The same, when it needs to read as a link rather than a control. */
      link: 'text-muted hover:text-body text-ui underline',
    },
    block: { true: 'w-full', false: '' },
  },
  defaultVariants: { variant: 'bordered', block: false },
})

/**
 * Available, or unavailable *with a stated reason*. There is no third case, and
 * no way to spell "disabled, reason to follow".
 */
type Availability =
  | { disabled?: false; disabledReason?: never }
  | { disabled: true; disabledReason: string }

/**
 * The union above cannot be produced by a conditional spread — `{...(busy ? {…}
 * : {})}` widens `disabled` to `true | undefined`, which matches neither member
 * and is a type error at the call site. That is the type working, but it pushes
 * every transient-busy button into a two-branch ternary around the whole
 * element, and a rule that is annoying to obey is a rule that gets a
 * `@ts-expect-error` instead.
 *
 * So: one helper, returning the union already narrowed. The reason is still
 * mandatory — there is no arity of this function that yields a disabled button
 * without one — and a blank one still throws in `Button`.
 */
export const unavailable = (when: boolean, reason: string): Availability =>
  when ? { disabled: true, disabledReason: reason } : {}

export type ButtonProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'disabled' | 'className' | 'type'
> &
  VariantProps<typeof button> &
  Availability & {
    children: ReactNode
    className?: string
    /** Always explicit. A bare `<button>` inside a form submits it. */
    type?: 'button' | 'submit'
  }

export function Button({
  variant,
  block,
  className,
  children,
  disabled,
  disabledReason,
  type = 'button',
  ...rest
}: ButtonProps) {
  const reasonId = useId()

  if (disabled && disabledReason.trim() === '') {
    throw new Error(
      'Button: a disabled control must carry a French reason next to it (DEC-26). ' +
        '`disabledReason` cannot be blank.',
    )
  }

  const control = (
    <button
      {...rest}
      type={type}
      disabled={disabled}
      aria-describedby={disabled ? reasonId : undefined}
      className={cn(button({ variant, block }), className)}
    >
      {children}
    </button>
  )

  if (!disabled) return control

  /*
   * `inline-flex` so dropping this into the flex header rows the screens
   * already use does not reflow them — the wrapper occupies the space the bare
   * button did, with the reason stacked under it.
   */
  return (
    <span className={cn('inline-flex min-w-0 flex-col items-start gap-tight', block && 'w-full')}>
      {control}
      <span id={reasonId} className="text-muted text-meta">
        {disabledReason}
      </span>
    </span>
  )
}
