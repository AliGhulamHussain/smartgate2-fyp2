import { useState } from "react";
import { ArrowRight, ScanFace } from "lucide-react";
import { useAuth } from "../auth";
import { Button, ErrorNote, Field, Input, Panel, Segmented } from "../ui";

const slugify = (text) =>
  text.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);

export default function Login() {
  const { login, signup } = useAuth();
  const [mode, setMode] = useState("signin");
  const [form, setForm] = useState({ email: "", password: "", full_name: "", organization_name: "", organization_slug: "" });
  const [slugTouched, setSlugTouched] = useState(false);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const set = (key) => (event) => {
    const value = event.target.value;
    setForm((f) => ({
      ...f,
      [key]: value,
      ...(key === "organization_name" && !slugTouched ? { organization_slug: slugify(value) } : {}),
    }));
  };

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === "signin") await login(form.email, form.password);
      else await signup(form);
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  return (
    <main className="relative z-10 grid min-h-dvh w-full max-w-full overflow-x-hidden lg:grid-cols-[1.15fr_1fr]">
      <section className="flex flex-col justify-between px-6 py-10 sm:px-12 lg:px-16 lg:py-14">
        <div className="flex items-center gap-2.5">
          <span className="flex size-9 items-center justify-center rounded-[11px] bg-accent text-accent-ink shadow-[inset_0_1px_0_rgb(255_255_255/0.5)]">
            <ScanFace className="size-5" aria-hidden />
          </span>
          <span className="text-lg font-semibold tracking-tight">SmartGate</span>
        </div>

        <div className="reveal my-16 max-w-5xl lg:my-0">
          <h1 className="text-[clamp(2.6rem,5vw,4.75rem)] font-semibold leading-[1.02] tracking-[-0.045em]">
            Every arrival,
            <span className="block text-fg-3">quietly recognized.</span>
          </h1>
          <p className="mt-6 max-w-xl text-[17px] leading-relaxed text-fg-2">
            Face-recognition attendance for schools, universities and offices. Check-ins, late arrivals and unknown
            visitors, handled at the gate.
          </p>
        </div>

        <p className="hidden text-sm text-fg-3 lg:block">Faces are matched on the device. Only descriptors reach the server.</p>
      </section>

      <section className="flex items-center justify-center px-4 pb-12 sm:px-8 lg:py-12">
        <Panel className="reveal w-full max-w-[440px] p-7 sm:p-9" style={{ "--i": 2 }}>
          <Segmented
            label="Account"
            value={mode}
            onChange={(value) => {
              setMode(value);
              setError(null);
            }}
            options={[
              { value: "signin", label: "Sign in" },
              { value: "signup", label: "New organization" },
            ]}
          />

          <h2 className="mt-8 text-2xl font-semibold tracking-tight">
            {mode === "signin" ? "Welcome back" : "Register your organization"}
          </h2>
          <p className="mt-1.5 text-sm text-fg-3">
            {mode === "signin"
              ? "Sign in with your SmartGate account."
              : "You will become the organization's first administrator."}
          </p>

          <form onSubmit={submit} className="mt-7 flex flex-col gap-4">
            {mode === "signup" && (
              <>
                <Field label="Organization name">
                  {(id) => <Input id={id} required maxLength={150} value={form.organization_name} onChange={set("organization_name")} placeholder="Riverside University" />}
                </Field>
                <Field label="Short name" hint="Lowercase letters, numbers and dashes.">
                  {(id) => (
                    <Input
                      id={id}
                      required
                      minLength={3}
                      maxLength={60}
                      pattern="[a-z0-9]+(-[a-z0-9]+)*"
                      value={form.organization_slug}
                      onChange={(e) => {
                        setSlugTouched(true);
                        set("organization_slug")(e);
                      }}
                      placeholder="riverside-university"
                    />
                  )}
                </Field>
                <Field label="Your full name">
                  {(id) => <Input id={id} required maxLength={100} autoComplete="name" value={form.full_name} onChange={set("full_name")} />}
                </Field>
              </>
            )}
            <Field label="Email">
              {(id) => <Input id={id} type="email" required autoComplete="email" value={form.email} onChange={set("email")} placeholder="you@organization.edu" />}
            </Field>
            <Field label="Password" hint={mode === "signup" ? "At least 12 characters." : undefined}>
              {(id) => (
                <Input
                  id={id}
                  type="password"
                  required
                  minLength={mode === "signup" ? 12 : undefined}
                  autoComplete={mode === "signin" ? "current-password" : "new-password"}
                  value={form.password}
                  onChange={set("password")}
                />
              )}
            </Field>

            <ErrorNote error={error} />

            <Button type="submit" variant="primary" loading={busy} className="mt-2 w-full">
              {mode === "signin" ? "Sign in" : "Create organization"}
              {!busy && <ArrowRight className="size-4" aria-hidden />}
            </Button>
          </form>
        </Panel>
      </section>
    </main>
  );
}
