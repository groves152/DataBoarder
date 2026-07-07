import { useTagData } from "@/hooks/useTagData";
import type { ImageData } from "@/types";

interface Props { run: string; tag: string }

export function ImagePanel({ run, tag }: Props) {
  const entries = useTagData(run, tag);
  const latest = entries.at(-1);
  const data = latest?.data as ImageData | undefined;

  if (!data?.png_b64) return <div className="p-4 text-gray-400 text-sm">No image yet</div>;

  return (
    <div className="flex flex-col h-full p-2">
      <img src={`data:image/png;base64,${data.png_b64}`} alt={tag}
        className="max-w-full max-h-full object-contain" />
    </div>
  );
}
