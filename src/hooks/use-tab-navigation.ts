import type { NavTabKey } from "@/components/navbar";
import { useRouter, type Href } from "expo-router";

const ROUTES: Record<NavTabKey, Href> = {
  home: "/",
  history: "/explore",
  friends: "/map",
  settings: "/settings",
};

export function useTabNavigation() {
  const router = useRouter();
  return (tab: NavTabKey) => router.navigate(ROUTES[tab]);
}
