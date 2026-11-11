import React from 'react';
import { View, Text } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { AirQualityData } from '../data/mock-air-quality';
import { statusColors, statusLabels } from '../data/mock-air-quality';

interface AQIBadgeProps {
  status: AirQualityData['status'];
}

const statusIcons: Record<AirQualityData['status'], string> = {
  baik: 'thumbs-up',
  sedang: 'info',
  tidak_sehat_kelompok_sensitif: 'alert-circle',
  tidak_sehat: 'alert-triangle',
  sangat_tidak_sehat: 'alert-octagon',
};

export const AQIBadge = React.memo(({ status }: AQIBadgeProps) => {
  const colors = statusColors[status];
  const label = statusLabels[status];
  const icon = statusIcons[status];

  return (
    <View className={`flex-row items-center justify-between py-3 px-4 rounded-lg border ${colors.bg} ${colors.border}`}>
      <View className="flex-row items-center flex-1">
        <Feather name={icon as any} size={20} color={colors.text.replace('text-', '')} />
        <Text className={`ml-3 font-semibold ${colors.text}`}>{label}</Text>
      </View>
    </View>
  );
});

AQIBadge.displayName = 'AQIBadge';
