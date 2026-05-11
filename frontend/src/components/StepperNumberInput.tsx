'use client';

import { useRef } from 'react';
import {
  ActionIcon,
  NumberInput,
  NumberInputHandlers,
  NumberInputProps,
} from '@mantine/core';
import { Minus, Plus } from 'lucide-react';

export function StepperNumberInput(props: NumberInputProps) {
  const handlersRef = useRef<NumberInputHandlers>(null);
  return (
    <NumberInput
      {...props}
      hideControls
      handlersRef={handlersRef}
      leftSectionPointerEvents="auto"
      rightSectionPointerEvents="auto"
      leftSectionWidth={40}
      rightSectionWidth={40}
      leftSection={
        <ActionIcon
          variant="subtle"
          color="indigo"
          aria-label="減少"
          tabIndex={-1}
          disabled={props.disabled}
          onClick={() => handlersRef.current?.decrement()}
        >
          <Minus size={16} strokeWidth={2.4} />
        </ActionIcon>
      }
      rightSection={
        <ActionIcon
          variant="subtle"
          color="indigo"
          aria-label="增加"
          tabIndex={-1}
          disabled={props.disabled}
          onClick={() => handlersRef.current?.increment()}
        >
          <Plus size={16} strokeWidth={2.4} />
        </ActionIcon>
      }
      styles={{
        input: { textAlign: 'center', fontVariantNumeric: 'tabular-nums' },
      }}
    />
  );
}
