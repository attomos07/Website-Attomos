package storage

// bucket_inventory.go — helpers del bucket para las fotos del Inventario
// (subir, leer y borrar por key). Usan el mismo cliente/credenciales que
// bucket.go (getBucketClient); el bucket es privado y las fotos se sirven
// por el backend en /media/inventario/foto/:fotoId.

import (
	"bytes"
	"context"
	"io"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"
)

// BucketReady: ¿hay credenciales del bucket configuradas?
func BucketReady() bool {
	_, _, err := getBucketClient()
	return err == nil
}

// UploadObject sube data al bucket bajo key.
func UploadObject(ctx context.Context, key string, data []byte, contentType string) error {
	client, bucket, err := getBucketClient()
	if err != nil {
		return err
	}
	_, err = client.PutObject(ctx, &s3.PutObjectInput{
		Bucket:        aws.String(bucket),
		Key:           aws.String(key),
		Body:          bytes.NewReader(data),
		ContentType:   aws.String(contentType),
		ContentLength: aws.Int64(int64(len(data))),
	})
	return err
}

// GetObject regresa el contenido (hay que cerrarlo) y su Content-Type.
func GetObject(ctx context.Context, key string) (io.ReadCloser, string, error) {
	client, bucket, err := getBucketClient()
	if err != nil {
		return nil, "", err
	}
	out, err := client.GetObject(ctx, &s3.GetObjectInput{Bucket: aws.String(bucket), Key: aws.String(key)})
	if err != nil {
		return nil, "", err
	}
	ctype := ""
	if out.ContentType != nil {
		ctype = *out.ContentType
	}
	return out.Body, ctype, nil
}

// DeleteObject borra key del bucket.
func DeleteObject(ctx context.Context, key string) error {
	client, bucket, err := getBucketClient()
	if err != nil {
		return err
	}
	_, err = client.DeleteObject(ctx, &s3.DeleteObjectInput{Bucket: aws.String(bucket), Key: aws.String(key)})
	return err
}
