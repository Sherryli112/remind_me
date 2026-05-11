'use client';

import type { CSSProperties, ReactNode } from 'react';
import { ActionIcon, Badge, Group, Paper, Stack, Text, Tooltip } from '@mantine/core';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, PenLine, Power, PowerOff, Trash2 } from 'lucide-react';

type RowDisplayProps = {
  title: string;
  scheduleSummary: string;
  enabled: boolean;
  expired: boolean;
};

type SortableProps = RowDisplayProps & {
  id: string;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
};

// 拖曳中的原位置：保留版面但變淡 + 虛線框，
// 讓使用者一眼看到「這格正被搬動」、不會誤以為沒反應
const placeholderStyle: CSSProperties = {
  background: 'rgba(199, 210, 254, 0.22)',
  borderStyle: 'dashed',
  borderColor: 'rgba(99, 102, 241, 0.55)',
  boxShadow: 'none',
};

// DragOverlay 漂浮卡片：純樣式（陰影 + 邊框）區分「被拿起來」。
// `animation: 'none'` 是用來覆蓋 .surface-subtle 的 surface-fade-in 動畫，
// 避免漂浮卡每次 portal mount 時都有 0.42s 淡入感，造成手感 lag。
const overlayStyle: CSSProperties = {
  cursor: 'grabbing',
  borderColor: 'rgba(165, 180, 252, 0.95)',
  boxShadow:
    'inset 0 1px 0 0 rgba(255, 255, 255, 0.9),' +
    ' 0 10px 20px rgba(79, 70, 229, 0.14),' +
    ' 0 2px 6px rgba(15, 23, 42, 0.06)',
  animation: 'none',
};

type RowContentProps = RowDisplayProps & {
  handle: ReactNode;
  onToggle?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
};

function RowContent({
  title,
  scheduleSummary,
  enabled,
  expired,
  handle,
  onToggle,
  onEdit,
  onDelete,
}: RowContentProps) {
  return (
    <Group justify="space-between" align="center" wrap="nowrap" gap="sm">
      {/* grip 放最左邊，cursor 抓著時卡片從 grip 往右延伸，跟閱讀方向一致 */}
      {handle}
      <Stack gap={2} style={{ flex: 1, minWidth: 0 }}>
        <Group gap="xs" wrap="nowrap">
          <Text fw={600} c="dark.7" truncate>
            {title}
          </Text>
          {!enabled ? (
            <Badge variant="light" color="gray" size="sm">
              已停用
            </Badge>
          ) : expired ? (
            <Badge variant="light" color="orange" size="sm">
              已過期
            </Badge>
          ) : null}
        </Group>
        <Text size="xs" c="dimmed">
          {scheduleSummary}
        </Text>
      </Stack>
      <Group gap={4} wrap="nowrap">
        <Tooltip label={enabled ? '停用提醒' : '啟用提醒'}>
          <ActionIcon variant="subtle" color={enabled ? 'indigo' : 'gray'} onClick={onToggle}>
            {enabled ? <Power size={14} /> : <PowerOff size={14} />}
          </ActionIcon>
        </Tooltip>
        <Tooltip label="編輯提醒">
          <ActionIcon variant="subtle" color="gray" onClick={onEdit}>
            <PenLine size={14} />
          </ActionIcon>
        </Tooltip>
        <Tooltip label="刪除提醒">
          <ActionIcon variant="subtle" color="red" onClick={onDelete}>
            <Trash2 size={14} />
          </ActionIcon>
        </Tooltip>
      </Group>
    </Group>
  );
}

export function SortableReminderRow({
  id,
  title,
  scheduleSummary,
  enabled,
  expired,
  onToggle,
  onEdit,
  onDelete,
}: SortableProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
  });

  const baseStyle: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : !enabled ? 0.55 : expired ? 0.78 : 1,
  };

  return (
    <Paper
      ref={setNodeRef}
      className="surface-subtle surface-interactive"
      radius="md"
      p="sm"
      style={isDragging ? { ...baseStyle, ...placeholderStyle } : baseStyle}
    >
      <RowContent
        title={title}
        scheduleSummary={scheduleSummary}
        enabled={enabled}
        expired={expired}
        onToggle={onToggle}
        onEdit={onEdit}
        onDelete={onDelete}
        handle={
          <Tooltip label="拖曳調整優先順序（同群組內）">
            <ActionIcon
              variant="subtle"
              color="gray"
              {...attributes}
              {...listeners}
              style={{
                cursor: isDragging ? 'grabbing' : 'grab',
                touchAction: 'none',
              }}
            >
              <GripVertical size={14} />
            </ActionIcon>
          </Tooltip>
        }
      />
    </Paper>
  );
}

export function ReminderRowOverlay({
  title,
  scheduleSummary,
  enabled,
  expired,
}: RowDisplayProps) {
  return (
    <Paper
      className="surface-subtle surface-interactive"
      radius="md"
      p="sm"
      style={{ ...overlayStyle, pointerEvents: 'none' }}
    >
      <RowContent
        title={title}
        scheduleSummary={scheduleSummary}
        enabled={enabled}
        expired={expired}
        handle={
          <ActionIcon
            variant="subtle"
            color="gray"
            style={{ cursor: 'grabbing', touchAction: 'none' }}
            tabIndex={-1}
          >
            <GripVertical size={14} />
          </ActionIcon>
        }
      />
    </Paper>
  );
}
