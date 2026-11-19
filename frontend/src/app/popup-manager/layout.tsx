import './popup-manager.css';
import { DesktopOnly } from '../../components/DesktopOnly';

// 彈窗管理視窗只在桌面 App 裡使用；在瀏覽器開啟時 DesktopOnly 會導回首頁
export default function PopupManagerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <DesktopOnly>{children}</DesktopOnly>;
}
