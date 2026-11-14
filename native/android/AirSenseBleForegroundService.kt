package __PACKAGE__

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder

class AirSenseBleForegroundService : Service() {
  override fun onCreate() {
    super.onCreate()
    createNotificationChannel()
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val notification = createNotification()
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      var serviceType = ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE
      if (intent?.getBooleanExtra(EXTRA_LOCATION_PERMISSION, false) == true) {
        serviceType = serviceType or ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION
      }
      startForeground(NOTIFICATION_ID, notification, serviceType)
    } else {
      startForeground(NOTIFICATION_ID, notification)
    }
    return START_STICKY
  }

  override fun onBind(intent: Intent?): IBinder? = null

  private fun createNotificationChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val channel = NotificationChannel(
      CHANNEL_ID,
      "Koneksi wearable",
      NotificationManager.IMPORTANCE_LOW,
    )
    channel.description = "Mempertahankan koneksi dan mencoba menghubungkan ulang wearable."
    getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
  }

  private fun createNotification(): Notification {
    val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      Notification.Builder(this, CHANNEL_ID)
    } else {
      Notification.Builder(this)
    }
    return builder
      .setSmallIcon(android.R.drawable.stat_sys_data_bluetooth)
      .setContentTitle("AirSense memantau wearable")
      .setContentText("Koneksi BLE aktif atau sedang mencoba menghubungkan ulang.")
      .setCategory(Notification.CATEGORY_SERVICE)
      .setOngoing(true)
      .build()
  }

  companion object {
    const val CHANNEL_ID = "airsense-ble-service"
    const val NOTIFICATION_ID = 4211
    const val EXTRA_LOCATION_PERMISSION = "locationPermissionGranted"
  }
}
