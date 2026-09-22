import { useHighlight } from '@mantine/code-highlight';
import { Box, Input, Textarea, useComputedColorScheme } from '@mantine/core';
import { useRef } from 'react';

interface SqlEditorProps {
  value: string;
  onChange: (value: string) => void;
  label: string;
  description?: string;
  placeholder?: string;
  minRows?: number;
  maxRows?: number;
}

export function SqlEditor({
  value,
  onChange,
  label,
  description,
  placeholder,
  minRows = 3,
  maxRows = 25,
}: SqlEditorProps) {
  const colorScheme = useComputedColorScheme();
  const highlight = useHighlight();
  const highlightRef = useRef<HTMLPreElement>(null);
  const highlighted = highlight({
    code: value || ' ',
    language: 'sql',
    colorScheme,
  });

  return (
    <Input.Wrapper label={label} description={description}>
      <Box pos="relative" mt={description ? 5 : 0}>
        <Box
          aria-hidden
          className="sql-editor-highlight"
          component="pre"
          ref={highlightRef}
          style={{
            position: 'absolute',
            inset: 0,
            margin: 0,
            overflow: 'hidden',
            padding: '10px 12px',
            borderRadius: 'var(--mantine-radius-default)',
            background: 'var(--mantine-color-default)',
            fontFamily: 'var(--mantine-font-family-monospace)',
            fontSize: 'var(--mantine-font-size-sm)',
            lineHeight: 1.55,
            whiteSpace: 'pre-wrap',
            overflowWrap: 'break-word',
            pointerEvents: 'none',
          }}
        >
          <code
            {...highlighted.codeElementProps}
            {...(highlighted.isHighlighted
              ? {
                  dangerouslySetInnerHTML: {
                    __html: highlighted.highlightedCode,
                  },
                }
              : { children: highlighted.highlightedCode })}
          />
        </Box>
        <Textarea
          aria-label={label}
          autosize
          maxRows={maxRows}
          minRows={minRows}
          onChange={(event) => onChange(event.currentTarget.value)}
          onScroll={(event) => {
            if (highlightRef.current) {
              highlightRef.current.scrollTop = event.currentTarget.scrollTop;
              highlightRef.current.scrollLeft = event.currentTarget.scrollLeft;
            }
          }}
          placeholder={placeholder}
          spellCheck={false}
          value={value}
          styles={{
            input: {
              position: 'relative',
              zIndex: 1,
              padding: '10px 12px',
              color: 'transparent',
              caretColor: 'var(--mantine-color-text)',
              background: 'transparent',
              fontFamily: 'var(--mantine-font-family-monospace)',
              fontSize: 'var(--mantine-font-size-sm)',
              lineHeight: 1.55,
            },
          }}
        />
      </Box>
    </Input.Wrapper>
  );
}
