"use client";

// Small primitives that reproduce the design's `style-hover` / `style-focus`
// behaviour, which plain React inline styles can't express. Everything in the
// Assessly build is inline-styled (to match the design exactly), so these just
// merge an extra style object on hover/focus.

import React, { useState } from "react";

/** Merge a hover/focus `override` over a `base` style. When the override sets
 *  `borderColor`, the base `border` shorthand is expanded to longhand on EVERY
 *  render (active or not) so React never sees a shorthand↔longhand transition
 *  for the same element (which it warns about). */
function mergeStyle(base?: React.CSSProperties, override?: React.CSSProperties, active?: boolean): React.CSSProperties | undefined {
  let b = base;
  if (override?.borderColor && typeof base?.border === "string") {
    const parts = base.border.split(" ");
    b = { ...base };
    delete (b as Record<string, unknown>).border;
    b.borderWidth = parts[0];
    b.borderStyle = parts[1];
    b.borderColor = parts.slice(2).join(" ");
  }
  return active && override ? { ...b, ...override } : b;
}

type DivProps = Omit<React.HTMLAttributes<HTMLDivElement>, "style"> & {
  style?: React.CSSProperties;
  hover?: React.CSSProperties;
  title?: string;
};

export function HBox({ style, hover, children, ...rest }: DivProps) {
  const [h, setH] = useState(false);
  return (
    <div
      {...rest}
      onMouseEnter={(e) => {
        setH(true);
        rest.onMouseEnter?.(e);
      }}
      onMouseLeave={(e) => {
        setH(false);
        rest.onMouseLeave?.(e);
      }}
      style={mergeStyle(style, hover, h)}
    >
      {children}
    </div>
  );
}

type BtnProps = Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "style"> & {
  style?: React.CSSProperties;
  hover?: React.CSSProperties;
};

export function HBtn({ style, hover, children, disabled, ...rest }: BtnProps) {
  const [h, setH] = useState(false);
  return (
    <button
      {...rest}
      disabled={disabled}
      onMouseEnter={() => setH(true)}
      onMouseLeave={() => setH(false)}
      style={mergeStyle(style, hover, h && !disabled)}
    >
      {children}
    </button>
  );
}

type InputProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, "style"> & {
  style?: React.CSSProperties;
  focusStyle?: React.CSSProperties;
};

export function HInput({ style, focusStyle, ...rest }: InputProps) {
  const [f, setF] = useState(false);
  return (
    <input
      {...rest}
      onFocus={(e) => {
        setF(true);
        rest.onFocus?.(e);
      }}
      onBlur={(e) => {
        setF(false);
        rest.onBlur?.(e);
      }}
      style={mergeStyle(style, focusStyle, f)}
    />
  );
}

type TextareaProps = Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, "style"> & {
  style?: React.CSSProperties;
  focusStyle?: React.CSSProperties;
};

export function HTextarea({ style, focusStyle, ...rest }: TextareaProps) {
  const [f, setF] = useState(false);
  return (
    <textarea
      {...rest}
      onFocus={(e) => {
        setF(true);
        rest.onFocus?.(e);
      }}
      onBlur={(e) => {
        setF(false);
        rest.onBlur?.(e);
      }}
      style={mergeStyle(style, focusStyle, f)}
    />
  );
}

/** A spinner dot used inside status pills / process trackers. */
export function Spinner({ size = 11, color = "#000f47", track = "rgba(0,15,71,.25)" }: { size?: number; color?: string; track?: string }) {
  return (
    <span
      className="ax-spin"
      style={{
        width: size,
        height: size,
        border: `2px solid ${track}`,
        borderTopColor: color,
        borderRadius: "50%",
        display: "inline-block",
        flexShrink: 0,
      }}
    />
  );
}
