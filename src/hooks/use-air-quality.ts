import { useState, useEffect } from 'react';
import { AirQualityData, Recommendation, mockAirQualityData, mockRecommendations } from '../data/mock-air-quality';

interface UseAirQualityReturn {
  data: AirQualityData | null;
  recommendations: Recommendation[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

export const useAirQuality = (): UseAirQualityReturn => {
  const [data, setData] = useState<AirQualityData | null>(null);
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = () => {
    setLoading(true);
    setError(null);

    // Simulate API call with mock data
    setTimeout(() => {
      try {
        setData(mockAirQualityData);
        setRecommendations(mockRecommendations);
        setLoading(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error occurred');
        setLoading(false);
      }
    }, 500);
  };

  useEffect(() => {
    fetchData();
  }, []);

  return {
    data,
    recommendations,
    loading,
    error,
    refetch: fetchData,
  };
};
