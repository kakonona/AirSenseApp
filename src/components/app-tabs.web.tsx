import { TabList, Tabs, TabSlot, TabTrigger } from "expo-router/ui";

export default function AppTabs() {
  return (
    <Tabs>
      <TabSlot style={{ height: "100%" }} />
      <TabList style={{ display: "none" }}>
        <TabTrigger name="home" href="/" />
        <TabTrigger name="explore" href="/explore" />
        <TabTrigger name="map" href="/map" />
        <TabTrigger name="settings" href="/settings" />
      </TabList>
    </Tabs>
  );
}
