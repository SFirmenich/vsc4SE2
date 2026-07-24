from django.db import migrations, models
import core.models


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0003_event_receipts"),
    ]

    operations = [
        migrations.AlterField(
            model_name="activityversion",
            name="checksum_sha256",
            field=models.CharField(blank=True, max_length=64, null=True, unique=True),
        ),
        migrations.AddField(
            model_name="activityversion",
            name="status",
            field=models.CharField(
                choices=[("draft", "Draft"), ("imported", "Imported")],
                default="imported",
                max_length=20,
            ),
        ),
        migrations.AlterField(
            model_name="activityversion",
            name="original_zip",
            field=models.FileField(blank=True, upload_to=core.models.activity_zip_upload_to),
        ),
    ]
