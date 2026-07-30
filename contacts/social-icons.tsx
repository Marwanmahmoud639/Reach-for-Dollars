import { Linkedin, Facebook, Instagram, Twitter, Youtube } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

type SocialContact = {
  linkedin_url?: string | null;
  facebook_url?: string | null;
  instagram_url?: string | null;
  twitter_url?: string | null;
  youtube_url?: string | null;
};

const PLATFORMS = [
  { key: "linkedin_url", Icon: Linkedin, label: "LinkedIn", color: "text-[#0A66C2]" },
  { key: "facebook_url", Icon: Facebook, label: "Facebook", color: "text-[#1877F2]" },
  { key: "instagram_url", Icon: Instagram, label: "Instagram", color: "text-[#E1306C]" },
  { key: "twitter_url", Icon: Twitter, label: "Twitter/X", color: "text-foreground" },
  { key: "youtube_url", Icon: Youtube, label: "YouTube", color: "text-[#FF0000]" },
] as const;

interface SocialIconsProps {
  contact: SocialContact;
  size?: "sm" | "md";
  className?: string;
}

export function SocialIcons({ contact, size = "md", className }: SocialIconsProps) {
  const iconSize = size === "sm" ? 14 : 18;
  return (
    <TooltipProvider delayDuration={150}>
      <div className={cn("flex items-center gap-1.5", className)}>
        {PLATFORMS.map(({ key, Icon, label, color }) => {
          const url = (contact as Record<string, string | null | undefined>)[key];
          const found = !!url;
          const content = (
            <Icon
              size={iconSize}
              className={cn(
                "transition-colors",
                found ? color : "text-muted-foreground/40",
              )}
            />
          );
          return (
            <Tooltip key={key}>
              <TooltipTrigger asChild>
                {found ? (
                  <a
                    href={url!}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="inline-flex items-center justify-center rounded p-0.5 hover:bg-accent"
                    aria-label={`View ${label} profile`}
                  >
                    {content}
                  </a>
                ) : (
                  <span
                    className="inline-flex items-center justify-center rounded p-0.5 cursor-not-allowed"
                    aria-label={`${label} profile not found`}
                  >
                    {content}
                  </span>
                )}
              </TooltipTrigger>
              <TooltipContent>
                {found ? `View ${label} Profile` : `${label} profile not found`}
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>
    </TooltipProvider>
  );
}
